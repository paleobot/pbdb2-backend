## 0. Baseline

- [x] 0.1 From `migrations/`, run the payload audit with `--round-trip` against localhost `pbdb` for `schema`, `character`, `state` and `collection`, and record the results. Expected: 8 schemas, 336 characters, 1,325 states and 275,554 collections, each with 0 violations and 0 differences.
- [x] 0.2 Run `npm test` and `npm run test:integration` at the root, and record that both pass.
- [x] 0.3 Start the API against localhost `pbdb` and capture all 8 schemas, single and as a list (`?limit=100`), to a file in the scratchpad (D9)

## 1. Schema source and codecs (`payloadSchemas/`)

- [x] 1.1 In `schema.schema.js`:
  - replace `references` with `primaryReference` and `additionalReferences` as in D1;
  - set base `required` to `title` and `year`, and make root `x-create` require `primaryReference` alongside the `year` pattern;
  - rewrite the header comment: what is stored, the repeated primary, and the backlog entry.
- [x] 1.2 In `lib/codecs.js`, delete `referenceList` and its comment, remove it from `codecs`, and fix any comment that still names it (D2)
- [x] 1.3 Update the tests that use `references[]` or `referenceList` in `tests/storage.test.js`, `tests/sources.test.js` and `tests/variants.test.js`:
  - delete the `referenceList` tests;
  - add schema cases from the spec: `referencePermid` for the schema primary, `referenceLinks` writing `additional_schema_refs`;
  - the schema `in-create` cases: a missing primary, the old `references[]`, `order` on an item, a repeated primary in `out`.
- [x] 1.4 Add a test that `characterSource` and `stateSource` declare no codec (D5)
- [x] 1.5 Run `npm test` at the root

## 2. Audit (`migrations/`)

- [x] 2.1 Check that `src/audit-payloads.js` needs no code change: its schemas `REGISTRY` entry already selects `reference_id` and the `additional_schema_refs` rows. Fix anything the 2.2 re-run shows.
- [x] 2.2 Re-run the 0.1 audits. Each must match its baseline, now with `out` validating the schema link fields.

## 3. Repository (`api/src/lib/`)

- [x] 3.1 In `resource-tables.js`, give `schemas` `source: schemaSource` and `children: [{ table: 'additional_schema_refs', fk: 'schema_id' }]`, and remove its `links`. Remove `joinTable` and `joinKey` from the `LinkDeclaration` typedef and its comments (D3, D6).
- [x] 3.2 In `repository.js` (D6):
  - make `makeReadRepository` throw an error naming the table when it has no `source`;
  - delete `toResource` and the `linkProjections` fallback;
  - delete the join-table branch of `linkProjections`;
  - update the header comment, which names `schemas` as the exception.
- [x] 3.3 In `crud-routes.js`, remove the `links` option and its `hydrateLinkHrefs` fallback. Check that taxa still pass their own `hydrate`.

## 4. Tree read and route

- [x] 4.1 In `schema-tree.js` (D4, D5):
  - drop the `linkProjections` import, `SCHEMA_LINK_COLUMNS` and `reference_id` from the query;
  - select `quantitative` in `state_tree`;
  - build each node with `merge(characterSource | stateSource, …)`;
  - return the nested characters only, and rename the export to say so;
  - rewrite the header comment.
- [x] 4.2 In `routes/api/v1/schemas/index.js`:
  - single read: `repository.readHead(permid)` (404 when null), then the characters query, returning `{ ...head, characters }`;
  - `hydrate` becomes `hydrateSourceLinks(record, schemaSource, fastify.prefix)`;
  - replace the stubs with the D8 ones;
  - rewrite the header comment.

## 5. API tests

- [x] 5.1 Port the descriptor-link tests in `test/link-enrichment.test.js` that build a generic repository from `links` to `linkProjections` and `hydrateLinkHrefs` directly, or to `makeTaxaRepository`. Delete the schemas SQL pin and the join-table cases, and add an assertion that no descriptor declares `joinTable` (D6).
- [x] 5.2 In `test/repository.test.js`:
  - update the schemas tree tests to the fake-pg queries D4 issues (heads, child rows, `refs`, then the tree);
  - assert `quantitative` on a state and that no node carries internal columns;
  - replace the "no links config" and synthetic `collectionLinks` tests with one that `makeReadRepository` without a source throws;
  - update the schemas stub test.
- [x] 5.3 In `test/source-reads.test.js`, add schemas, validated as D7 says. Cover the list, `ids`, single and stub reads, and:
  - child rows with a repeated primary;
  - no child rows;
  - an untitled reference;
  - a removed primary;
  - a removed additional reference;
  - a tree with a quantitative state, a state under a state, and a character under a character.

  Also assert that a page of schemas costs three queries.
- [x] 5.4 In `test/integration/reads.test.js`, update the schema fixtures to source-valid payloads, add an `additional_schema_refs` row repeating the primary, and a quantitative state. Validate the single read in parts and the list whole. Keep the swing-trigger case.
- [x] 5.5 Run `npm test` and `npm run test:integration` at the root; both must pass

## 6. Verify and record

- [x] 6.1 Start the API against localhost `pbdb`, capture the 0.3 reads again, and diff them. The only differences must be the ones D9 lists: key order, and `quantitative` on every state (true on 73).
- [x] 6.2 Update `api/CLAUDE.md` ("Reads through a payload source"): every version-chained resource reads this way, and only `taxa` keeps descriptor `links`.
- [x] 6.3 Update `api/docs/response-contracts.md` (schemas are the fourth resource on design A; remove "Schemas still use `references[]`") and the backlog's "Collection reference model" and "API responses vs. the `out` variants" entries. Say that the reference-model answer now applies to collections and schemas alike.
- [x] 6.4 Rollback check: confirm the change writes no data and no DDL, so reverting its commit is the whole rollback
