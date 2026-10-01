## 1. Link-target registry

- [x] 1.1 In `src/lib/resource-tables.js`, add a `LINK_TARGETS` map keyed by route-group name: `references` → `{ table: 'refs', payloadColumn: 'reference', label: 'title' }`, `authorities` → `{ table: 'authorities', payloadColumn: 'authority', label: 'citation' }`
- [x] 1.2 Document in the module comment that the key is a route-group name doing double duty (SQL source + href base) so the two cannot drift, and that the registry is where a future target needing an explicit head filter would declare it
- [x] 1.3 Add a `targetFor(group)` lookup and the `LinkTarget` / `LinkDeclaration` typedefs alongside the existing descriptor typedefs

## 2. Generalize the descriptor declarations

- [x] 2.1 Rename the descriptor key `references:` → `links:` and restate each entry as a link declaration carrying `target`, `via`, and `on` (plus `joinTable`/`joinKey` for many-to-many)
- [x] 2.2 Convert the four existing declarations with no behavior change: `authorities.reference`, `collections.primaryReference` + `additionalReferences`, `schemas.primaryReference` + `additionalReferences` — all `target: 'references'`, `on: 'id'`
- [x] 2.3 Update the `ResourceDescriptor` typedef; keep the existing comment's explanation of why FKs live on the table rather than in the JSONB

## 3. Parameterize the projections

- [x] 3.1 In `src/lib/repository.js`, rename `referenceProjections` → `linkProjections` and resolve table, payload column, and label key from the declaration's target instead of the hardcoded `refs`/`reference`/`title`
- [x] 3.2 Emit the join predicate from `on`: `id` → `<target>.id = <citing>.<via>`; `permid` → `<target>.permid = <citing>.<via>`
- [x] 3.3 Keep the label's output key equal to the target's label name (`title` for references, `citation` for authorities) and keep `permid` alongside it
- [x] 3.4 Preserve SQL-side soft-removal suppression for both single-valued and join-table links, and keep identifier/literal quoting on every interpolated table, column, and key
- [x] 3.5 Confirm the generated SQL for the four existing declarations is unchanged from before the refactor (string-compare against the current output in a test)

## 4. Generalize href hydration

- [x] 4.1 Rename `src/lib/reference-hydration.js` → `src/lib/link-hydration.js`; `referencesBase` → `groupBase(prefix, group)`; `hydrateReferenceHrefs` → `hydrateLinkHrefs`
- [x] 4.2 Resolve each link's href base from its own `target` rather than taking one base per record, so a record may carry links to different groups
- [x] 4.3 Keep the prefix-derived derivation (no hard-coded `/api/v1`) and the existing no-op safety for null links, empty arrays, missing fields, and absent config
- [x] 4.4 Update the module doc comment to describe link hydration generally, retaining the reasoning about why no href can point at a soft-removed target

## 5. Update consumers

- [x] 5.1 `src/lib/crud-routes.js`: consume the renamed helpers and the `links` descriptor key
- [x] 5.2 `src/lib/schema-tree.js`: consume `linkProjections` with the schemas descriptor's `links`, keeping the `ts` CTE qualifier behavior identical
- [x] 5.3 Update the four route files that read `descriptorFor(x).references` to read `.links`
- [x] 5.4 Grep for any remaining `reference`-specific helper names or imports and confirm none are left

## 6. Tests

- [x] 6.1 Run the existing enrichment suites unmodified — they are the regression contract; any test needing an edit to pass means behavior moved and must be investigated, not updated
- [x] 6.2 Assert the emitted SQL for the four existing declarations is byte-identical to the pre-refactor output
- [x] 6.3 New: a descriptor declaring `target: 'authorities'` produces a `{ citation, permid, href }` object with `href` = `/api/v1/authorities/{permid}` (fake-pg)
- [x] 6.4 New: a descriptor declaring `on: 'permid'` emits a `permid`-matching join predicate rather than an id-matching one, and yields the same object shape
- [x] 6.5 New: a record carrying links to two different target groups hydrates each href against its own group base
- [x] 6.6 New: soft-removal suppression holds for a non-`references` target — single-valued → `null`, join-table entry → omitted
- [x] 6.7 Confirm no internal serial id is exposed by either join form

## 7. Verify

- [x] 7.1 Run `npm test` — all suites green, with the pre-existing enrichment tests unmodified
- [x] 7.2 Run `npm run test:integration` if a database is reachable; confirm real enriched reads are unchanged (this suite skips cleanly with no DB)
- [x] 7.3 Diff a few real enriched responses (authorities, collections, schemas — single, list, and stub) before and after; confirm byte-identical output
