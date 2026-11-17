## 0. Baseline

- [x] 0.1 From `migrations/`, run the payload audit with `--round-trip` against localhost `pbdb` for `collection`, `schema` and `authority`, and record the results. Expected: collections 275,554 heads, authorities 163,067 heads, and schemas at their current count, each with 0 violations and 0 differences.
- [x] 0.2 Run `npm test` and `npm run test:integration` at the root, and record that both pass.

## 1. Storage layer (`payloadSchemas/lib/storage.js`)

- [x] 1.1 In `storageGroups`, take a single-property codec group's link from `prop['x-link'] ?? prop.items?.['x-link']`, and pass `storage.property` (the property's name) to every single-property codec group (D2, D3)
- [x] 1.2 In `collectCodecSources`, apply the same items rule when attaching `labels` (D2)
- [x] 1.3 In `codecKeyColumns`, leave out any looked-up table that a codec annotated with a `table` also reads, and update its comment to say why (D6)
- [x] 1.4 Add `storageSelects(source)` and `codecKeySites(source)` (D6)
- [x] 1.5 Unit-test 1.1–1.4 in `tests/storage.test.js`:
  - the items link reaches `storage.link`;
  - `storage.property` is passed for a single property and not for `wgs84Point`;
  - the collection labels dedup into one `refs` source;
  - `codecKeyColumns(collectionSource)` has no `refs` entry, while authority keeps it;
  - `storageSelects` and `codecKeySites` for collection and authority.

## 2. Codecs and variants

- [x] 2.1 In `lib/codecs.js`, make `referencePermid` read and emit under `storage.property` instead of `reference` (D3)
- [x] 2.2 Add `referenceLinks` with `keyColumn: 'reference_id'`, as the spec says (D4):
  - merge orders rows by id, omits removed references, adds labels, and always emits an array;
  - split reads permid only and throws on a removed reference.
- [x] 2.3 Add `select(column)` to `wgs84Point` (D6)
- [x] 2.4 In `lib/variants.js`, move the `out` nullable rule into the `properties` loop, so that a link property becomes nullable and a link under `items` does not. Update the header comment (D5).
- [x] 2.5 Unit-test 2.1–2.4 in `tests/storage.test.js` and `tests/variants.test.js`:
  - `referencePermid` under two property names;
  - `referenceLinks`: labels, no label, a removed reference, `[]`, and a split that ignores `title` and throws on a removed permid;
  - `wgs84Point.select`;
  - `out` rejects a `null` item and accepts a `null` root link.

## 3. Collection source

- [x] 3.1 In `collection.schema.js`:
  - replace `references` with `primaryReference` and `additionalReferences` as in D1;
  - change root `x-create` to require `context` and `primaryReference`;
  - rewrite the comment above them: what is stored, the repeated primary, and the backlog entry.
- [x] 3.2 Update the collection cases in `tests/sources.test.js`, `tests/variants.test.js` and `tests/storage.test.js` that use `references[]`:
  - create bodies;
  - the `db` and `out` property lists;
  - round trips, including one with a repeated primary;
  - the `in-create` cases from the spec (a label on an item, `order` on an item, a missing primary).
- [x] 3.3 Confirm that the schema source and its `referenceList` tests pass unchanged
- [x] 3.4 Run `npm test` at the root

## 4. Audit (`migrations/`)

- [x] 4.1 Check that `src/audit-payloads.js` needs no code change. `REGISTRY` already selects `reference_id` and the child rows, and `codecKeyColumns` now leaves `refs` out for collections. Fix anything the 0.1 re-run below shows.
- [x] 4.2 Re-run the 0.1 audits. Each must match its baseline, now with `out` validating the link fields and items.

## 5. Database index (`db/`)

- [x] 5.1 Add an index on `additional_collection_refs (collection_id)` in `db/02-core.sql`, with a comment noting that the API reads child rows by parent. Create the same index on localhost `pbdb`, so it doesn't drift from the DDL.

## 6. API repository and hydration (`api/`)

- [x] 6.1 In `src/lib/repository.js`, for a source-backed descriptor (D7):
  - select `id` and `storageSelects(source)` (each aliased to its column) in place of `storageColumns`;
  - when the descriptor has `children`, run one child query per table for the page's head ids, and group the rows by parent;
  - restrict the codec context through `codecKeySites`, over the rows and child rows;
  - pass `children` to `merge`;
  - keep `id` out of the record.

  Authorities must behave exactly as before.
- [x] 6.2 In `src/lib/link-hydration.js`, extend `hydrateSourceLinks` to add `href` to each item of a root array whose `items` carry `x-link` (D8)
- [x] 6.3 In `src/lib/resource-tables.js`, give `collections` `source: collectionSource` and `children: [{ table: 'additional_collection_refs', fk: 'collection_id' }]`, and remove its `links`. Document `children` in the descriptor typedef.
- [x] 6.4 In `routes/api/v1/collections/`, pass `source` in place of `links`, and replace the stub with the source-shaped one from D9
- [x] 6.5 Update the existing unit tests that assume the collection SQL sub-selects, the old stub or `country`/`state`. These are in `test/link-enrichment.test.js` and `test/repository.test.js`, and any others the suite turns up.

## 7. Contract tests

- [x] 7.1 Extend `test/source-reads.test.js` with collections, validated against the collection `out`. With a fake pg, cover the single, list, `ids` and stub reads, and the D10 cases:
  - with and without coordinates;
  - child rows with a repeated primary;
  - no child rows;
  - an untitled reference;
  - a removed additional reference;
  - a removed primary.

  Also assert the query count: heads, child rows and `refs`.
- [x] 7.2 In `test/integration/reads.test.js`:
  - give the collection fixtures a `location` and source-valid payloads;
  - read a collection with a primary and two child rows, one of which repeats the primary;
  - validate the single and list responses against `out`;
  - add a removed-reference case;
  - keep the swing-trigger case, in which a new collection version keeps its `additionalReferences`.

## 8. Verify and record

- [x] 8.1 Run `npm test` and `npm run test:integration` at the root; both must pass
- [x] 8.2 Read a collection from the running API on localhost (`npm start -w api`) and check the response by eye:
  - `location.coordinates` is present;
  - `primaryReference` and `additionalReferences` carry `href`;
  - no `id`, `reference_id` or raw geometry appears.

  Time a page of 100 collections against the authorities page, to confirm the child-row query is cheap with the 5.1 index.
- [x] 8.3 Update `api/docs/response-contracts.md`: collections are the second resource built on design A. Note the array-of-links shape.
- [x] 8.4 Update the "API responses vs. the `out` variants" backlog entry to match, and check that the "Collection reference model" entry is still accurate.
- [x] 8.5 Update `api/CLAUDE.md`'s "Reads through a payload source" paragraph: collections now read through their source, with child rows.
- [x] 8.6 Rollback check: confirm that reverting the change's commit leaves no data to undo. Only the 5.1 index is a database change, and it can stay.
