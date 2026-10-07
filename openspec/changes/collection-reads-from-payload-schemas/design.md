## Context

`authority-reads-from-payload-schemas` built design A (`api/docs/response-contracts.md` §6) for one
root link. Collections need three things that change did not build: a list of links, child rows,
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
      no labels, ignores `removed`
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

**Facts this design relies on** (localhost `pbdb`, 2026-10-07):
- `additional_collection_refs` is `(id, authorizer_person_id, enterer_person_id, collection_id,
  reference_id)`. It has no order column, no `removed` and no version chain.
- `collection_id` is a swing FK. 0 child rows hang off a superseded collection, so a page's head
  ids are enough to find its child rows.
- 0 collection heads have a NULL `reference_id`.
- 0 reference heads are soft-removed. The removal paths must work but no data exercises them.
- 371,774 child rows over 242,412 collections, at most 455 on one collection.
- `schemas` also uses `referenceList` (`additional_schema_refs`). Its API read goes through
  `schema-tree.js` and is not part of this change, but the payload audit merges schemas through the
  same codec.

## Goals / Non-Goals

**Goals:**
- Every collection GET (single, list and `ids`) is `merge()` output plus `href` values, and it
  validates against the collection `out` variant. A test proves it.
- Coordinates come back from `collections.location`.
- `references[]` items are links (`{ permid, order, title, href }`), with removed references
  omitted and stored orders kept.
- The array-of-links machinery is general: schemas should need only to put the same annotation on
  their items when their change comes.
- The payload audit still reports 0 violations and 0 differences for collections and schemas.

**Non-Goals:**
- **Schemas.** They keep `LINK_TARGETS`, `primaryReference` and `additionalReferences`. Their
  `references` items gain no `x-link`, so `referenceList` emits no labels for them.
- **Writes.** That covers what a GET → PATCH round trip does to an omitted removed reference, how
  orders with a gap are written back, and nested read-only screening. See Open Questions.
- **Links below the root.** `hydrateSourceLinks` reaches root properties and their `items`. No
  collection link sits deeper.
- **Taxa, references, specimens, the envelope.**
- **Retiring `LINK_TARGETS` and `linkProjections`.** Schemas and taxa still use them.

## Decisions

### D1. A link item is declared with `link()`, which takes extra properties

`link({ target, label, properties = {}, required = [] })` merges `properties` into the link's own and
appends `required` to `['permid']`. The collection source declares:

```js
references: {
  type: 'array',
  items: link({
    target: 'references', label: 'title',
    properties: { order: { type: 'string', description: 'Order of the reference' } },
    required: ['order'],
  }),
  minItems: 1,
  'x-storage': { table: 'additional_collection_refs', codec: 'referenceList' },
}
```

- `x-link` sits on the **items**, not on the array. The array is not a link; each item is. This
  also keeps `x-storage` and `x-link` on different nodes, so nothing has to decide which of them
  an annotation on an array means.
- `order` is writable: a create sends `{ permid, order }`.
- Items get `additionalProperties: false` from `link()`, as the root link does. Today's items allow
  any extra key. That was never intended, and no stored jsonb holds `references` (it is
  `x-storage`), so nothing at rest is affected.

Alternative considered: `x-link` on the array, with the codec told to treat each item as a link.
Rejected because the derived schema would then show item fields that come from nowhere in the
source, which D1 of the authorities change ruled out.

### D2. The storage layer finds a link on a codec property or on its items

One rule, used in both places that read `x-link` today: a codec property's link is
`prop['x-link'] ?? prop.items?.['x-link']`.

- `storageGroups` passes it as `storage.link`, as it does for a root link.
- `collectCodecSources` asks the codec's sources for its label, as it does for a root link.

Only `items` is reached, not deeper nesting. A codec owns the whole array value, so a link nested
further inside an item would be the codec's own business.

### D3. `referenceList` emits link items, omits removed references and keeps stored orders

**merge:**
- Orders are assigned exactly as today, before anything is left out: the primary gets `"1"`, and
  the child rows get `"2"`, `"3"`… by ascending id.
- An item whose reference id is in the source's `removed` set is then dropped. The others keep
  their orders, so a gap shows that something was removed. If the primary was removed, no item has
  order `"1"`.
- When `storage.link` names a label, each item carries it, and the key is left out when the label
  is missing. Without `storage.link` (schemas), items stay `{ permid, order }`.
- An id that is not a head still throws, as today.
- If every reference is removed, merge returns `references: []`. It does not leave the key out.
  The client sees that the collection cites nothing readable, not that the field is unknown.

**split:**
- Reads `permid` and `order` from each item and ignores every other key. That way the audit round
  trip can pass merged items that still carry `title`.
- As in `referencePermid`, a permid naming a removed reference throws.

**Why omit and not `null` items:** a `null` inside an array has no `order` and no position the
client can act on, and `reference-enrichment` already says removed references drop out of the list.
`out` therefore makes link **items** nullable nowhere (D4).

**Why keep stored orders rather than renumber:** renumbering would make the primary look like it
moved when it was only removed. It would also make the orders a client sees differ from the ones
split derives from storage, so the audit could not compare them.

**Effect on schemas:** they share the codec, so they get omission too. With 0 removed references
on localhost the audit can't tell the difference, and their API read doesn't use merge.

### D4. `out` makes a root link nullable, and lifts `minItems` from an array of links

The authorities change made every `x-link` node `['object', 'null']` in `out`. That rule moves into
the `properties` loop of `transform`: a **property** carrying `x-link` becomes nullable. A schema
reached through `items` does not. Root links behave as before.

An array whose `items` carry `x-link` loses `minItems` in `out` only. Once every reference is
removed, `references: []` is a true response. `in-create` keeps `minItems: 1`, and so does `db`
(where the property is dropped anyway).

Alternative considered: keep `minItems` in `out` and treat an all-removed list as an integrity
failure (a 500). Rejected: removing a reference is a normal edit, and it must not make every
collection that cites it unreadable.

### D5. Codecs declare the columns they read and how to select them

Two optional codec fields, read by `payloadSchemas/lib/storage.js`:

- **`keyColumn`** on `referenceList`: `'reference_id'`. It is the column that holds a refs id, both
  on the parent row (the primary) and on each child row. Today the name is hard-coded in the codec
  and invisible to the storage layer. That is why `storageColumns` doesn't select it and
  `codecKeyColumns` can't restrict `refs` for collections.
- **`select(column)`** on `wgs84Point`: returns the SQL expression merge expects,
  `ST_AsGeoJSON("<column>")::json`. The codec comment already says merge expects that. This makes
  the claim something a caller can read.

From these, `storage.js` gains:
- `storageColumns(source)` also lists a codec's `keyColumn` (`reference_id` for collections and
  schemas). It still returns names.
- `storageSelects(source)` returns `[{ column, expression }]`, where `expression` is the codec's
  `select(column)` when it has one and the quoted column otherwise. The repository builds its
  select list from this instead of `storageColumns`.
- `codecKeySites(source)` returns, per source table, the parent columns and the child-table
  columns that hold its keys: for collections,
  `refs → { columns: ['reference_id'], children: { additional_collection_refs: ['reference_id'] } }`.
  For authorities it returns `refs → { columns: ['reference_id'], children: {} }`, so the
  repository needs one rule for both.

**`codecKeyColumns` is left alone.** The audit uses it to decide what to preload. It leaves
child-keyed sources out of the map on purpose, so collections and schemas preload `refs` once per
run. Changing it would make the audit restrict `refs` to parent columns only, and merge would then
throw on the first child row. The audit retires with `migrations/`, so a second function is cheaper
than reworking it.

### D6. The repository loads child rows, which the descriptor declares

The descriptor gains `children: [{ table, fk }]`. For collections that is
`[{ table: 'additional_collection_refs', fk: 'collection_id' }]`, the audit's `REGISTRY` shape
without `columns`.

- **Why the descriptor and not the source:** the codec comment says the child row's key back to
  its parent is the caller's business. The source describes the payload. Which column joins a child
  table to its parent is a fact about tables, and the descriptor already holds the resource's table.
- **Columns:** the child query selects `id` and the codec's `keyColumn`s for that table. `id` is
  what `referenceList` orders by. Each `keyColumn` comes from `codecKeySites`. No audit columns
  (`authorizer_person_id`, `enterer_person_id`) are read.

A source-backed read becomes:
1. The head query selects `id`, `permid`, the payload and `storageSelects(source)`. `id` is needed
   to find child rows. It never reaches the response, because the record is `merge()` output, and
   merge emits only the jsonb plus what the annotations rebuild.
2. If the descriptor has `children`, it runs one query per child table:
   `SELECT <fk> AS parent, id, <keyColumns> FROM <table> WHERE <fk> = ANY($1) ORDER BY id`, with
   the page's head ids. The rows are grouped by parent.
3. It loads one codec context. Each source table is restricted, through `codecKeySites`, to the
   keys found in the page's rows and child rows. A source with no key sites is read in full, as
   today.
4. It builds each record with
   `merge(source, { jsonb, columns: row, children: { <table>: rowsFor(row.id) } }, ctx)`.

A page of collections costs three queries: heads, child rows and `refs`. A single read is a page
of one.

### D7. `href` reaches link items

`hydrateSourceLinks` handles two cases for each root property:
- If the property carries `x-link`, it adds `href` to the value, as today.
- If its `items` carry `x-link` and the value is an array, it adds `href` to each item.

The base comes from `x-link.target` in both cases.

### D8. Collections switch to the source path; the stub takes the source's shape

- `RESOURCE_DESCRIPTORS.collections` drops `links` and gains `source: collectionSource` and
  `children`. The route passes `source` to `registerCrudRoutes` in place of `links`.
- **Stub:** `{ permid, name: 'Stub collection',
  location: { toponym: { administrativeArea: { admin0: 'US', admin1: 'California' } } },
  references: [{ permid: 'ref-00000000', order: '1', title: 'Stub reference' }] }`, then hydrated.
  Today's `country` and `state` move to where the source keeps them. The exact keys are whatever
  the collection `out` variant accepts, because the stub passes the same contract test.

### D9. Contract tests validate responses against `out`

These follow the authorities change's D7, with collection cases:
- **Unit (fake pg):** single, list, `ids` and the stub, each validated against
  `deriveVariant(collectionSource, 'out')` after enum resolution. Cases:
  - coordinates present, and absent (`location` NULL);
  - a primary plus additional references, in id order;
  - an untitled reference;
  - a removed additional reference (a gap);
  - a removed primary (no `"1"`);
  - every reference removed (`[]`).
- **Integration:** a fixture collection with a location, a primary and two additional references,
  read through the real DDL, plus a removed-reference case. Fixture permids are minted with
  `newPermid()`.
- **payloadSchemas unit tests:** `link()` with extra properties, the items rule in
  `collectCodecSources` and `storageGroups`, the nullable and `minItems` rules in `out`, the three
  `referenceList` merge outcomes, `storageSelects` and `codecKeySites`.

### D10. The payload audit follows the codec

- The audit's `split` call passes merged items that now carry `title`. Split ignores `title` (D3),
  so the child-row comparison is unchanged.
- `validateOut` now checks link items, including `additionalProperties: false`. The labels it needs
  load through `collectCodecSources`, because the items rule (D2) adds `title` to the preloaded
  `refs` source.
- `REGISTRY` is unchanged. It still names its own columns and children. `codecKeyColumns` is
  unchanged (D5).
- Re-run the audit on localhost for collections and schemas, with `--round-trip`. Expected:
  collections 275,554 heads and schemas their current count, with 0 violations and 0 differences
  for both. Then run authorities as a regression check (163,067 heads, 0 and 0).

## Risks / Trade-offs

- **[GET → PATCH drops a removed citation]** A client that writes back what it read loses the
  omitted reference. If the primary was removed, split promotes the lowest remaining order to
  primary.
  → Reads only for now. Recorded for the write path (Open Questions). That change must decide
  whether a removed citation is kept on write.
- **[Two key-column functions]** `codecKeyColumns` (audit) and `codecKeySites` (API) answer close
  questions differently.
  → The comment on `codecKeyColumns` says why it leaves child keys out. It goes when `migrations/`
  retires.
- **[Codecs gain metadata]** `keyColumn` and `select` widen the codec interface.
  → Both are optional, and a codec without them behaves as today. `keyColumn` replaces a name that
  was hard-coded and invisible. It doesn't add a new one.
- **[Page cost]** A page of 100 collections can pull up to 100 × 455 child rows in the worst case.
  On real data the mean is about 1.5.
  → One indexed `= ANY` query. The page limit bounds it. Check that `collection_id` is indexed
  during apply, and add the index to `db/02-core.sql` if it is not.
- **[Breaking response shape]** `primaryReference` and `additionalReferences` go away for
  collections but stay for schemas, so the two resources differ until the schemas change.
  → Stated in the proposal. Both read the same codec, so converging means adding the annotation to
  schemas, not new mechanism.
- **[`items` now reject unknown keys]** A create body with an extra key inside a reference item
  fails `in-create`.
  → That is the intended contract, and no write route exists yet.

## Migration Plan

- No data migration. Nothing in the jsonb, `collections` or `additional_collection_refs` changes.
- Ordinary API release. Clients move from `primaryReference` and `additionalReferences` to
  `references[]` for collections, and see `location.coordinates` for the first time.
- Roll back by reverting the commit.

## Open Questions

- **BLOCKING (2026-10-07): is reference order real data?** Nothing stores `order`.
  `additional_collection_refs` has no order column, Classic's `secondary_refs` is an unordered set,
  and the migration inserts child rows in MariaDB stream order. `referenceList` derives `"2"`, `"3"`…
  from child row ids, so the "stored orders" in D3 are derived, not stored. PBot keeps reference
  order, and PBDB2 probably should too, but that awaits confirmation. The options:
  - **A.** Store a position column on `additional_collection_refs` and `additional_schema_refs`.
  - **B.** Drop `order`, leaving a primary plus an unordered set.
  - **C.** Keep deriving the order.

  D1 and D3, and the proposal's `references[]` shape, depend on the answer. Specs wait for it.

- **Write path:** keep or drop a removed reference when a PATCH rewrites `references`, and what a
  gap in `order` means on write (renumber, or reject). Add to `docs/api-design-backlog.md` beside
  the nested `readOnly` guard.
- **Schemas:** whether their change only annotates `items`, or also needs the `schema-tree.js`
  read to call merge. That gets settled there.
