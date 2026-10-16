## Why

Schemas are the last version-chained resource still read as `{ permid, ...payload }` plus descriptor
links. Their payload source also disagrees with their own response: the source declares
`references[]` with a derived `order` (`referenceList`), while the API returns `primaryReference`
and `additionalReferences`, the shape collections took in `collection-reads-from-payload-schemas`.

The committee's answer on the reference model (`docs/api-design-backlog.md`, "Collection reference
model") is delayed by a convention. Whichever way it goes, schemas must end up the same as
collections. Today they are on a different shape, so the answer would need two different edits.
Converting schemas to the collection shape now means the answer is applied once, to both, and is
already in place if order turns out not to be wanted. If order is wanted, schemas take the same edit
as collections, on 8 rows instead of 242,000.

Separately, the schema tree read never returns a state's `quantitative`. It selects the raw jsonb,
and `quantitative` lives in `states.quantitative` (`x-storage: { column: "quantitative" }`). On
localhost, 73 of 1,325 current states are quantitative, and the API reports none of them.

## What Changes

- **The schema source describes the stored references.** `references[]` (`{ permid, order }`,
  through `referenceList`) is replaced by the two collection properties:
  - `primaryReference`: one link from `schemas.reference_id`, through `referencePermid`;
  - `additionalReferences`: an unordered array of links, one per `additional_schema_refs` row,
    through `referenceLinks`.

  Root `x-create` requires `primaryReference`. The rows are returned as stored. Localhost has one
  child row, on one schema, and it repeats that schema's primary, as on collections.
- **Schema reads go through `merge()`.** `GET /schemas` and `?ids=` read through the repository's
  source path, with `additional_schema_refs` as a child table. `GET /schemas/{permid}` takes the
  schema head from the same repository, and the tree query fetches only characters and states.
- **Every tree node is merged through its source.** Each character goes through `characterSource`
  and each state through `stateSource`. A state therefore carries `quantitative` from its column.
  This fixes the missing `quantitative`.
- **Removals (the old read path):**
  - the repository's non-source branch (`toResource`, and selecting descriptor link sub-selects for
    the generic repository). Every generic-repository resource now has a source;
  - the many-to-many (`joinTable`/`joinKey`) form of descriptor links, whose only user was schemas.
    Taxa keep the single-valued descriptor links;
  - the `referenceList` codec, which has no caller left.
- **Response shape:** the field names don't change. The changes are:
  - link objects take the source-link shape. An untitled reference omits `title` instead of
    returning `title: null` (no schema on localhost cites an untitled reference);
  - key order may change, as it did for references;
  - states gain `quantitative`;
  - the stubs take the source's shape.

  Schema write verbs are still stubs, so no client writes `references[]` today.
- **Unchanged:** the schemas migration, which writes `reference_id` and `additional_schema_refs`
  directly and validates only the jsonb; the database; the tree's nesting and order; taxa; the other
  resources.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `payload-schema-variants`:
  - the schema source replaces `references[]` with `primaryReference` and `additionalReferences`;
  - the annotation list for the schema source changes to match;
  - `referenceList` is removed; `referencePermid` and `referenceLinks` gain the schema as a caller.
- `data-access`:
  - `schemas` joins the source-backed resources, with `additional_schema_refs` as a child table;
  - the repository has no non-source path for a version-chained resource;
  - the schema tree read takes its head from the repository and merges each node through its
    source;
  - contract tests cover schemas.
- `reference-enrichment`:
  - schema reference links come from the source, not descriptor links;
  - descriptor links lose the many-to-many form;
  - the stub requirement covers schemas as it does collections.
- `resource-routes`: the schemas aggregate read returns merged nodes, including a state's
  `quantitative`.
- `payload-audit`: the round-trip requirement stops naming `referenceList`. `refs` is still
  pre-loaded for collection and schema, now because `referenceLinks` reads child-table rows; the
  collection and schema scenarios describe `primaryReference` and `additionalReferences`.

## Impact

- **Code:**
  - `payloadSchemas/`: `schema.schema.js`, `lib/codecs.js` (remove `referenceList`), and the tests
    that use `references[]` or `referenceList`;
  - `api/src/lib/`: `resource-tables.js` (schemas gains `source` and `children`, loses `links`;
    the link typedef loses `joinTable`/`joinKey`), `repository.js` (removes the non-source branch
    and the many-to-many sub-select), `schema-tree.js` (head from the repository, nodes merged);
  - `api/src/routes/api/v1/schemas/`;
  - tests: `repository.test.js`, `link-enrichment.test.js`, `source-reads.test.js`,
    `integration/reads.test.js`.
- **Migrations:** no change to `migrate-pbot-schemas.js`. `src/audit-payloads.js` round-trips
  schemas through the new codecs; a re-run on localhost (8 schema heads) confirms it.
- **Data integrity:** none at risk. This change only reads, and writes no row and no DDL.
- **API clients:** see the response shape above. The visible changes are `quantitative` on states,
  and a missing `title` key instead of `null` on an untitled reference.
- **Docs:** `api/CLAUDE.md`, `api/docs/response-contracts.md` and the backlog's "Collection reference
  model" entry, which says schemas still use `references[]`.
- **Deferred:** the reference model stays with the committee. Its answer now applies to collections
  and schemas identically.
