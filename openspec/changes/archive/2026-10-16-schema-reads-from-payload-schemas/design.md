## Context

`collection-reads-from-payload-schemas` built everything a schema read needs: arrays of links,
child rows, `referenceLinks`, and `codecKeySites`. Schemas were left out because their reference
model waits on the committee, along with collections'. The committee is away, and this change
converts schemas anyway (proposal, "Why").

**What exists:**

```
payloadSchemas/schema.schema.js                 api/src/lib/
  references[]: { permid, order }                 resource-tables.js  schemas: jsonbColumn + links
    x-storage { table: additional_schema_refs,      primaryReference      (id-keyed, reference_id)
                codec: referenceList }              additionalReferences  (joinTable additional_schema_refs)
payloadSchemas/lib/codecs.js                      repository.js
  referenceList   ← schemas only                    source path: merge() + children + codecKeySites
  referencePermid ← authority, collection           other path:  linkProjections + toResource ← schemas only
  referenceLinks  ← collection                     schema-tree.js  (GET /schemas/:permid)
payloadSchemas/{character,state}.schema.js           one recursive query: head jsonb + link sub-selects
  permid          x-storage { column }               + char/state raw jsonb; assemble() nests in JS
  state.quantitative x-storage { column }         routes/api/v1/schemas/index.js
                                                    list via listReadHandler + hydrateLinkHrefs
```

**Facts this design relies on** (localhost `pbdb`, 2026-10-16):
- 8 schema heads, 336 character heads and 1,325 state heads, all current and not removed.
- `additional_schema_refs` has 1 row, on schema 4, and it cites that schema's own primary: the same
  repeat as on collections.
- No schema cites an untitled or a removed reference.
- 73 states have `quantitative = true`. None has `quantitative` in its jsonb, as the state source
  requires, so the tree read reports none of them.
- `merge()` passes `ctx` only to codecs. The character and state sources declare no codec, so they
  merge with no codec context.
- The PBot schemas migration writes `reference_id` and `additional_schema_refs` directly. It
  validates only the jsonb, which never holds the references.
- `additional_schema_refs` has no index on `schema_id`.
- Outside tests, the generic repository's non-source path serves only schemas. Taxa read through
  `taxa-repository.js`, which uses `linkProjections` with single-valued links only. Unit tests in
  `link-enrichment.test.js` and `repository.test.js` use the non-source path as a harness for
  descriptor-link SQL, including a synthetic many-to-many link.

## Goals / Non-Goals

**Goals:**
- Schemas match collections in the source, the codecs and the response, so that the committee's
  answer is one edit applied to both.
- Every schema GET is `merge()` output plus `href` values. The list and `ids` reads validate against
  the schema `out` variant, and so does the single read apart from its `characters` tree.
- Every character and state node in the tree is merged through its source. A state carries
  `quantitative`.
- The old read path is gone: the generic repository reads only through a source, descriptor links
  are single-valued, and `referenceList` is deleted.

**Non-Goals:**
- The reference model (order, and whether the primary belongs in the child table).
- Writes. The schema write verbs stay stubs, and the source's create shape is not exercised by a
  route.
- How the tree is exposed: separate `characters`/`states` routes, `$defs`, and whether `out`
  describes the tree. These stay in `docs/api-design-backlog.md`.
- An index on `additional_schema_refs (schema_id)`. It has 1 row; add one when the table grows.
- Specimens, which stay stubbed.

## Decisions

### D1. The schema source copies the collection's reference properties

`references` is replaced by `primaryReference` (`link({ target: "references", label: "title" })`,
`x-storage: { column: "reference_id", codec: "referencePermid" }`) and `additionalReferences` (an
array of those links, `x-storage: { table: "additional_schema_refs", codec: "referenceLinks" }`).
Base `required` becomes `title` and `year`, and root `x-create` requires `primaryReference`, as on
collections. The source comment says the rows are returned as stored and points at the backlog
entry.

The two codecs need no change. `referencePermid` emits under `storage.property`, and
`referenceLinks` writes to whatever child table `x-storage` names.

*Alternatives:*
- **Keep `references[]` until the committee answers.** Then the answer needs two different edits:
  schemas would move from a list and collections from two fields. It also leaves the response
  disagreeing with the source.
- **Rename to something schema-specific.** No reason exists to differ, and the point is that they
  don't.

### D2. `referenceList` is deleted, not kept for the "order wanted" answer

`referenceList` keeps the primary in `reference_id` and derives the order from the child rows' ids.
If order is wanted, the backlog's plan drops `reference_id` and gives the child table a position
column. Neither half of `referenceList` survives that, so keeping it would keep code no answer
uses.

### D3. The schemas descriptor reads through its source

`schemas` gets `source: schemaSource` and
`children: [{ table: 'additional_schema_refs', fk: 'schema_id' }]`, and loses `links`. The list and
`ids` reads then need no route code: `listReadHandler` already takes the repository. The route's
`hydrate` becomes `hydrateSourceLinks(record, schemaSource, prefix)`.

A page of schemas costs three queries (heads, child rows, `refs`), as on collections.

### D4. The single read is the repository head plus a characters-only tree query

```
GET /schemas/:permid
  ├─ repository.readHead(permid)          merge(schemaSource, …)   null → 404
  └─ readSchemaCharacters(pg, permid)     recursive CTE, no link columns
        nodes merged through characterSource / stateSource, then nested
  → { ...head, characters }
```

`schema-tree.js` keeps its recursive CTE. It drops the link sub-selects, `reference_id` and the
reference fallbacks in `assemble()`, and it returns the nested character list rather than a whole
record. The CTE still starts from the schema head by `permid`, under the same head filter.

*Alternative:* one query that also selects what `merge()` needs for the head (storage columns,
child rows, the `refs` context). That re-implements the repository's source path inside the tree
query, which is how the two drifted apart before. Two queries cost one round trip more on a single
read. If the schema is re-versioned between them, the swing trigger moves the characters to the new
head, so the tree query still finds them.

### D5. Tree nodes are merged through their sources

`char_tree` already selects `permid`; `state_tree` also selects `quantitative`. Each node is built as
`merge(characterSource | stateSource, { jsonb: payload, columns: { permid[, quantitative] } })`,
with no codec context, and `assemble()` adds `characters` and `states` to it as before.

This is the `quantitative` fix. Selecting `quantitative` and copying it into the node by hand would
also fix it. But the bug came from the tree knowing the storage layout itself, and the next
column-backed field would be missed the same way. With `merge()`, the sources decide.

If a character or state source later declares a codec, the tree has to load a codec context for it.
A unit test asserts that neither source declares a codec, so that change can't happen silently.

### D6. The generic repository reads only through a source

`makeReadRepository` requires `source` and throws a named error without one. Removed:
- `toResource` and the `linkProjections` fallback in `makeReadRepository`;
- the `links` option of `crudRoutes` and its `hydrateLinkHrefs` fallback. Taxa pass their own
  `hydrate`;
- the many-to-many form of a link declaration (`joinTable`, `joinKey`) in `linkProjections` and the
  `LinkDeclaration` typedef.

`linkProjections` and `hydrateLinkHrefs` stay, for taxa. The unit tests that used the generic
repository as a harness for descriptor links move to `linkProjections` and `hydrateLinkHrefs`
directly, or to `makeTaxaRepository`. The many-to-many cases are deleted.

*Alternative:* keep the non-source path for a future resource without a source. The only candidate
is specimens, and it has a source already. Keeping it would leave about 40 lines of untested
production code.

### D7. The response contract for the tree

`out` for a schema declares no `characters`, and `unevaluatedProperties: false` rejects it. Whether
`out` should describe the tree is an API design question (Non-Goals). The tests therefore check the
single read in parts:
- the record without `characters` against the schema `out`;
- each character node without `characters` and `states` against the character `out`;
- each state node without `states` against the state `out`.

The list and `ids` reads have no tree and are validated whole.

### D8. Stubs take the sources' shape

The schema stub is `{ permid, title, year, primaryReference: { permid, title }, additionalReferences: [] }`.
The tree stub adds one character holding one state, each in its source's shape, with
`quantitative: false` on the state. Both pass the D7 checks.

### D9. The response is compared before and after

All 8 schemas on localhost are captured, single and as a list, before and after the change. The
expected differences are:
- key order (`permid` moves, as it did for references);
- `quantitative` on the 73 quantitative states, and `quantitative: false` on the rest;
- nothing else.

The differences that localhost data can't show (an untitled reference loses `title: null`, a
removed reference) are covered by unit tests.

## Risks / Trade-offs

- **[The committee wants order]** → Schemas then take the same edit as collections. This change makes
  that edit identical for the two; it doesn't make it smaller for collections.
- **[A client reads `title: null` on an untitled reference]** → No schema on localhost has one, and the
  API has no clients beyond tests yet. Collections made the same change.
- **[Two queries on a single read]** → One more round trip on a read that already runs a recursive query.
  The tree query dominates.
- **[Test harness churn]** → Porting the descriptor-link tests is most of the API test work. The SQL they
  pin is unchanged for single-valued links, so the assertions carry over.
- **[Every state now carries `quantitative`]** → Correct per the state source: `merge()` copies the
  column, which is NOT NULL with a default of `false`. A client that only expected it on quantitative
  states sees `false` on the rest.

## Migration Plan

No data, DDL or migration change. A rollback is a revert of the commit. The audit re-run (8 schemas,
336 characters, 1,325 states) and the D9 capture are the checks against localhost.

## Open Questions

None blocking. The reference model stays in `docs/api-design-backlog.md`, and that entry is updated
to say schemas now have the collection shape.
