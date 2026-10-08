## Context

`authority-reads-from-payload-schemas` built design A (`api/docs/response-contracts.md` §6) for one
root link. Collections need three things that change did not build: an array of links, child rows,
and a column read through an SQL expression.

**What exists:**

```
payloadSchemas/                                   api/
  collection.schema.js                              resource-tables.js
    references[]: { permid, order }                   collections.links.primaryReference
      x-storage { table: additional_collection_refs,  collections.links.additionalReferences
                  codec: referenceList }                → LINK_TARGETS.references (SQL sub-selects)
    location.coordinates.{latitude,longitude}       repository.js
      x-storage { column: location, codec: wgs84Point }  source path: storageColumns + codecKeyColumns,
  lib/codecs.js                                         root columns only, no child rows
    referenceList: primary = reference_id, rest =   link-hydration.js
      child rows by ascending id; orders "1","2"…     hydrateSourceLinks: root x-link only
    referencePermid: emits the fixed key `reference`
    wgs84Point: merge expects ST_AsGeoJSON(col)::json
  lib/storage.js
    storageGroups: storage.link from prop['x-link']
    collectCodecSources: labels from prop['x-link']
    codecKeyColumns / storageColumns: x-storage.column only
  lib/variants.js  out: every x-link node nullable
migrations/src/audit-payloads.js
  REGISTRY collections: columns incl. ST_AsGeoJSON(location)::json AS location,
    children [{ additional_collection_refs, fk collection_id, columns [id, reference_id] }]
  codecKeyColumns has no refs entry for collections → refs preloaded once per run
```

**Facts this design relies on** (localhost `pbdb` and Classic `pbdb_archive`, 2026-10-08):
- `additional_collection_refs` is `(id, authorizer_person_id, enterer_person_id, collection_id,
  reference_id)`. It has no order column, no `removed` and no version chain.
- It is a copy of Classic's `secondary_refs`: 371,831 rows there and 371,774 here, because the
  migration drops orphans. Classic has `UNIQUE (collection_no, reference_no)`. Localhost has 0
  duplicate `(collection_id, reference_id)` pairs.
- **The primary is usually also a child row.** It is one for 242,310 of the 242,412 collections
  that have child rows (242,311 of 242,423 in Classic). For 187,540 collections, the primary is the
  only child row. About 33,000 collections have no child rows at all.
- `collection_id` is a swing FK. 0 child rows hang off a superseded collection, so a page's head
  ids are enough to find its child rows.
- 0 collection heads have a NULL `reference_id`. 0 reference heads are soft-removed. The removal
  paths must work, but no data exercises them.
- At most 455 child rows hang off one collection.
- `schemas` also uses `referenceList` (`additional_schema_refs`). Its API read goes through
  `schema-tree.js` and is not part of this change.

## Goals / Non-Goals

**Goals:**
- Every collection GET (single, list and `ids`) is `merge()` output plus `href` values, and it
  validates against the collection `out` variant. A test proves it.
- Coordinates come back from `collections.location`.
- `primaryReference` and `additionalReferences` keep their names and today's
  `reference-enrichment` contract. The primary is a link or `null`, and the additional references
  are links with removed ones omitted.
- The source describes what is stored: one column and an unordered set of child rows.
- The array-of-links machinery is general, so schemas need only the same annotations when their
  change comes.
- The payload audit still reports 0 violations and 0 differences for collections and schemas.

**Non-Goals:**
- **The reference model.** That covers ordering, and whether the primary belongs in the child table
  or the column should go. It awaits the committee (Open Questions). Until then, no data or
  migration changes, and the repeated primary is returned as stored.
- **Schemas.** They keep `references[]`, `referenceList` and `LINK_TARGETS`.
- **Writes.** That includes what a GET → PATCH round trip does to an omitted removed reference, and
  nested read-only screening.
- **Links below the root.** `hydrateSourceLinks` reaches root properties and their `items`. No
  collection link sits deeper.
- **Taxa, references, specimens, the envelope.**
- **Retiring `LINK_TARGETS` and `linkProjections`.** Schemas and taxa still use them.

## Decisions

### D1. The collection source declares two reference links

`references[]` is replaced by:

```js
primaryReference: {
  ...link({ target: 'references', label: 'title' }),
  'x-storage': { column: 'reference_id', codec: 'referencePermid' },
  description: 'the reference this collection is primarily recorded from',
},
additionalReferences: {
  type: 'array',
  items: link({ target: 'references', label: 'title' }),
  'x-storage': { table: 'additional_collection_refs', codec: 'referenceLinks' },
  description: 'every additional_collection_refs row, unordered; usually includes the primary',
},
```

- `x-create` requires `primaryReference` where it required `references`. `additionalReferences`
  stays optional, and `[]` is valid.
- **No `order`, and no `uniqueItems`.** The array is a set. It is emitted in ascending row id so
  responses are stable, but the contract doesn't promise any order. Uniqueness is left for the
  write path, because `uniqueItems` compares whole items, title included, and so would not express
  the rule.
- **The names match today's API**, so the reference part of the response doesn't break. They also
  match what schemas return through `LINK_TARGETS`.
- `x-link` sits on the **items**, not on the array. The array is not a link; each item is. This
  also keeps `x-storage` and `x-link` on different nodes. The source comment says that the primary
  usually repeats among the child rows, and points to the backlog entry.

Alternatives considered:
- **Keep `references[]` with derived orders.** Rejected: it presents an order that nothing stores
  while the committee is still deciding whether order is real data.
- **Drop the primary from `additionalReferences` on read.** Rejected: split can't restore the
  dropped rows, so the audit's round trip would break for 242,310 collections. It would also
  anticipate one of the committee's outcomes.

### D2. The storage layer finds a link on a codec property or on its items

One rule, used in both places that read `x-link` today: a codec property's link is
`prop['x-link'] ?? prop.items?.['x-link']`.
- `storageGroups` passes it as `storage.link`, as it does for a root link.
- `collectCodecSources` asks the codec's sources for its label, as it does for a root link.

Only `items` is reached, not deeper nesting. A codec owns the whole array value.

### D3. A single-property codec learns its property name

`storageGroups` already treats a codec group serving one property specially, because it passes
`storage.link`. It now also passes `storage.property` (the property's name). `referencePermid`
reads and writes `values[storage.property]` instead of the fixed key `reference`. So authorities'
`reference` and collections' `primaryReference` share the codec unchanged.

A codec that serves several properties (`wgs84Point`) gets no `storage.property` and keeps naming
its own keys.

### D4. `referenceLinks`: an unordered child table of reference links

The new codec has the same source as the others (`REFS_SOURCE`, heads only) and
`keyColumn: 'reference_id'` (D6).

**merge:**
- Takes the rows of `storage.table`, sorted by ascending id.
- Leaves out an item whose reference id is in the source's `removed` set.
- Turns each remaining row into `{ permid }`, plus `storage.link`'s label when the context holds
  one. The key is left out when the label is missing.
- Returns `{ [storage.property]: items }`. The result is `[]` when there are no rows or every row
  was removed. The key is never left out, because an empty set is a true answer.
- An id that is not a head throws, as in the other `refs` codecs.

**split:**
- Reads `permid` from each item and ignores every other key. The audit round trip passes merged
  items that still carry `title`.
- A permid naming a removed reference throws, as in `referencePermid`.
- Returns `children: { [storage.table]: items.map(→ { reference_id }) }`, and no columns.

`referenceList` is unchanged, and schemas still use it.

### D5. `out` makes a link property nullable, but not a link item

The authorities change made every `x-link` node `['object', 'null']` in `out`. That rule moves into
the `properties` loop of `transform`, so a **property** carrying `x-link` becomes nullable. A schema
reached through `items` does not, because a removed item is omitted rather than `null`. A `null`
inside a set has no meaning a client can act on, and `reference-enrichment` already says removed
references drop out. Root links, including `primaryReference`, behave as before.

### D6. Codecs declare the columns they read and how to select them

Two optional codec fields, read by `payloadSchemas/lib/storage.js`:
- **`keyColumn`** on `referenceLinks`: `'reference_id'`, the child-row column holding a refs id.
- **`select(column)`** on `wgs84Point`: returns the SQL expression merge expects,
  `ST_AsGeoJSON("<column>")::json`. The codec comment already says merge expects that, and this
  makes it something a caller can read.

From these, `storage.js` gains:
- `storageSelects(source)` returns `[{ column, expression }]`. `expression` is the codec's
  `select(column)` when it has one, and the quoted column otherwise. The repository builds its
  select list from this instead of `storageColumns`.
- `codecKeySites(source)` returns, for each source table, the parent columns and child-table
  columns that hold its keys:
  - collections: `refs → { columns: ['reference_id'], children: { additional_collection_refs: ['reference_id'] } }`;
  - authorities: `refs → { columns: ['reference_id'], children: {} }`.

  The repository therefore needs one rule for both.

**`codecKeyColumns` must change.** The audit uses it to decide which sources to restrict for each
batch. With `primaryReference` on a column, it would now return `refs → reference_id` for
collections. The audit would then load only the primaries' refs, and merge would throw on the first
child row that names another reference. So `codecKeyColumns` leaves out any source that a codec
annotated with a `table` also reads. Such a source is preloaded once per run, which is how the
audit handles collections today. Schemas are unaffected, and authorities still restrict by column.
A function whose callers both need child keys is cheaper than reworking the audit, which retires
with `migrations/`.

### D7. The repository loads child rows, which the descriptor declares

The descriptor gains `children: [{ table, fk }]`. For collections that is
`[{ table: 'additional_collection_refs', fk: 'collection_id' }]`, the audit's `REGISTRY` shape
without `columns`.
- **Why the descriptor and not the source:** the codec comment says the child row's key back to
  its parent is the caller's business. Which column joins a child table to its parent is a fact
  about tables, and the descriptor already holds the resource's table.
- **Columns:** the child query selects `id` (for a stable order) and the `keyColumn` values that
  `codecKeySites` lists for that table. No audit columns are read.

A source-backed read becomes:
1. The head query selects `permid`, the payload and `storageSelects(source)` (an expression is
   aliased to its column), plus `id` when the descriptor has `children`. Authorities' SQL is
   therefore unchanged. `id` is needed to find child rows. It never reaches the response, because merge emits only the jsonb plus what
   the annotations rebuild.
2. If the descriptor has `children`, the repository runs one query per child table:
   `SELECT <fk> AS parent, id, <keyColumns> FROM <table> WHERE <fk> = ANY($1) ORDER BY id`, with
   the page's head ids. The rows are grouped by parent.
3. It loads one codec context. Each source table is restricted through `codecKeySites` to the keys
   found in the page's rows and child rows. A source with no key sites is read in full, as today.
4. It builds each record with
   `merge(source, { jsonb, columns: row, children: { <table>: rowsFor(row.id) } }, ctx)`.

A page of collections costs three queries: heads, child rows and `refs`. A single read is a page
of one.

### D8. `href` reaches link items

`hydrateSourceLinks` handles two cases for each root property:
- If the property carries `x-link`, it adds `href` to the value, as today.
- If its `items` carry `x-link` and the value is an array, it adds `href` to each item.

In both cases the base comes from `x-link.target`.

### D9. Collections switch to the source path, and the stub takes the source's shape

- `RESOURCE_DESCRIPTORS.collections` drops `links` and gains `source: collectionSource` and
  `children`. The route passes `source` to `registerCrudRoutes` in place of `links`.
- **Stub:**
  ```js
  {
    permid,
    name: 'Stub collection',
    location: {
      toponym: { administrativeArea: { admin0: 'US', admin1: 'US-CA' } },
      scale: 'outcrop', // location requires scale; admin1 is ISO 3166-2
    },
    primaryReference: { permid: 'ref-00000000', title: 'Stub reference' },
    additionalReferences: [],
  }
  ```
  It is then hydrated. Today's `country` and `state` move to where the source keeps them. The stub
  passes the same contract test.

### D10. Contract tests validate responses against `out`

These follow the authorities change's D7, with collection cases.

**Unit (fake pg):** single, list, `ids` and the stub, each validated against
`deriveVariant(collectionSource, 'out')` after enum resolution. Cases:
- coordinates present, and absent (`location` NULL);
- a primary plus child rows, one of which repeats the primary (returned as stored);
- no child rows (`additionalReferences: []`);
- an untitled reference;
- a removed additional reference (omitted);
- a removed primary (`primaryReference: null`, with `out` still valid).

**Integration:** a fixture collection with a location, a primary and two child rows (one repeating
the primary), read through the real DDL, plus a case with a removed reference. Fixture permids are
minted with `newPermid()`.

**payloadSchemas unit tests:**
- the items rule in `collectCodecSources` and `storageGroups`;
- `storage.property`, with `referencePermid` under two property names;
- the nullable rule in `out`, for a property but not an item;
- `referenceLinks` merge and split, including removal, labels, `[]` and a split that ignores
  `title`;
- `storageSelects`, `codecKeySites`, and `codecKeyColumns` leaving out child-read sources.

### D11. The payload audit follows the source

- `REGISTRY` is unchanged. It still selects `reference_id` and the child rows.
- The round trip passes merged items that carry `title`. Both codecs' splits ignore it, so the
  column and child-row comparisons are unchanged. A repeated primary splits back into both the
  column and its child row, because the two properties are independent.
- Re-run the audit on localhost with `--round-trip`. Expected results, each with 0 violations and
  0 differences:
  - collections: 275,554 heads;
  - schemas: their current count;
  - authorities: 163,067 heads, as a check on the `referencePermid` property-name change and on
    `codecKeyColumns`.

## Risks / Trade-offs

- **[The primary is repeated in `additionalReferences`]** Most collections list their primary
  twice, once in each field. A client counting citations double-counts.
  → It is what is stored, and today's API already does it. The source and the
  `additionalReferences` description say so. The fix depends on the committee's answer (Open
  Questions).
- **[GET → PATCH drops a removed citation]** A client that writes back what it read loses the
  omitted reference.
  → Reads only for now. Recorded for the write path.
- **[Two key-column functions]** `codecKeyColumns` (the audit) and `codecKeySites` (the API) answer
  similar questions differently.
  → The comment on `codecKeyColumns` says why it leaves child-read sources out. The function goes
  when `migrations/` retires.
- **[Codecs gain metadata]** `keyColumn`, `select` and `storage.property` widen the codec
  interface.
  → All are optional, and a codec that doesn't use them behaves as today.
- **[Page cost]** A page of 100 collections can pull up to 100 × 455 child rows in the worst case.
  On real data the mean is about 1.5.
  → It is one indexed `= ANY` query, and the page limit bounds it. Check during apply that
  `collection_id` is indexed, and add the index to `db/02-core.sql` if it is not.
- **[The source shape may change again]** If the committee wants an ordered list, the source goes
  back to one array, and both the response and the create body change.
  → Accepted, so collection reads can move forward. The machinery built here (items links, child
  rows, expression columns) is needed either way.

## Migration Plan

- No data migration. Nothing in the jsonb, `collections` or `additional_collection_refs` changes.
- Ordinary API release. Collection responses gain `location.coordinates`, and their reference
  fields keep the same shape.
- Roll back by reverting the commit.

## Open Questions

- **Deferred to committee (2026-10-08): the collection reference model.** The outcome decides what
  happens to the repeated primary:
  - **Order is wanted:** keep only the child table, with a position column, and drop
    `collections.reference_id`. The primary is the first item. The source returns to one ordered
    array.
  - **Order is not wanted:** keep `reference_id` as the primary, and stop repeating it in
    `additional_collection_refs`. That means a migration change and roughly 242k fewer child rows.
    The two fields from this change stay, and `additionalReferences` then means what its name says.

  Recorded in `docs/api-design-backlog.md`. The same answer should carry over to schemas.
- **Write path:** keep or drop a removed reference when a PATCH rewrites the references, and
  whether a write may cite the primary again in `additionalReferences`. See
  `docs/api-design-backlog.md` (both recorded there, under "Collection reference model").
