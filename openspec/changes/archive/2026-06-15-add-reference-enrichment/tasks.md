## 1. Descriptor

- [x] 1.1 Add a `references` field to the `authorities` descriptor in `src/lib/resource-tables.js`: `primary { as: 'reference', via: 'reference_id' }`.
- [x] 1.2 Add a `references` field to the `collections` descriptor: `primary { as: 'primaryReference', via: 'reference_id' }` and `additional { as: 'additionalReferences', joinTable: 'additional_collection_refs', joinKey: 'collection_id' }`.
- [x] 1.3 Add a `references` field to the `schemas` descriptor: `primary { as: 'primaryReference', via: 'reference_id' }` and `additional { as: 'additionalReferences', joinTable: 'additional_schema_refs', joinKey: 'schema_id' }`.
- [x] 1.4 Update the descriptor JSDoc/typedef to document the optional `references` field shape; leave `references` and `specimens` without it.

## 2. Shared projection SQL

- [x] 2.1 Add a `refProjectionSql` helper (in `src/lib/repository.js` or a small shared module) that, given a descriptor `references` config and the citing table alias, returns the aliased primary scalar sub-select and additional `json_agg` sub-select expressions.
- [x] 2.2 Primary sub-select: `json_build_object('title', r.reference->>'title', 'permid', r.permid)` from `refs r WHERE r.id = <t>.reference_id AND NOT COALESCE(r.removed, false)`, aliased to `as`, yielding `NULL` when removed/absent.
- [x] 2.3 Additional sub-select: `COALESCE(json_agg(json_build_object('title', r.reference->>'title', 'permid', r.permid)), '[]'::json)` over `<joinTable> j JOIN refs r ON r.id = j.reference_id WHERE j.<joinKey> = <t>.id AND NOT COALESCE(r.removed, false)`, aliased to `as`.
- [x] 2.4 Ensure identifiers are quoted via the existing `ident` helper; reference column/table names come only from the trusted descriptor.

## 3. Generic repository enrichment

- [x] 3.1 In `makeReadRepository`, accept the descriptor's `references` and append the `refProjectionSql` expressions to the head-select for both `readHead` and `list`.
- [x] 3.2 Extend `toResource` to merge the projected reference columns into the record by their `as` key (alongside `permid` + payload), without leaking internal ids.
- [x] 3.3 Thread `references` through `repositoryForResource`/`makeReadRepository` from the descriptor.

## 4. Schema-tree enrichment

- [x] 4.1 In `src/lib/schema-tree.js`, add the primary and additional sub-selects (reusing `refProjectionSql`, correlated on the `target_schema` head) to the final select.
- [x] 4.2 Surface `primaryReference` and `additionalReferences` in `assemble`'s returned object without disturbing the characters/states tree.

## 5. href hydration at the boundary

- [x] 5.1 Add a descriptor-driven hydration step at the route/envelope boundary that, for each `references` `as` key present on a resource, sets `href = <references base>/{permid}` on the reference object(s).
- [x] 5.1a Derive the references base path from the route, not a literal: take the citing group's mounted prefix (`fastify.prefix`, e.g. `/api/v1/collections`), use its parent (the version base) and append `/references`; compute once per route group at registration.
- [x] 5.2 Apply hydration uniformly to single reads and to each item of a list; handle `null` primary and `[]` additional safely.
- [x] 5.3 Wire hydration into the authorities, collections, and schemas read paths (single + list, including the schema tree read) without adding URL knowledge to the persistence layer.

## 6. Stubs

- [x] 6.1 Add a `reference` object `{ title, permid, href }` to the `authorities` stub builder.
- [x] 6.2 Add `primaryReference` and `additionalReferences` to the `collections` and `schemas` stub builders (including the schema tree stub).

## 7. Tests

- [x] 7.1 Add integration seeders to `test/integration/helpers.js`: `insertAuthority`, `insertCollection`, `insertSchema`, `insertAdditionalCollectionRef`, `insertAdditionalSchemaRef`.
- [x] 7.2 In `test/integration/reads.test.js`, assert enriched single + list shapes for authorities (`reference`) and collections/schemas (`primaryReference` + `additionalReferences`), including `href`.
- [x] 7.3 Add an edit-then-reread integration case: edit a referenced ref and confirm `title` updates while `permid` is stable; edit a collection/schema and confirm `additionalReferences` survive the swing.
- [x] 7.4 Add a removed-reference-suppression integration case: removed primary → `null`; removed additional → omitted from the array.
- [x] 7.5 Add a repository unit test (`test/repository.test.js`) for the projection SQL building and `toResource` merge against the fake `pg`.
- [x] 7.6 Add/extend a no-DB stub-shape test asserting stub responses carry the enriched reference fields.

## 8. Verify

- [x] 8.1 Run `npm test` (no DB) and confirm green.
- [x] 8.2 Run `npm run test:integration` against a PostgreSQL instance and confirm the enrichment, swing, and suppression cases pass.
