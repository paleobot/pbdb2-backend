## 0. Baseline

- [x] 0.1 Run `node src/audit-payloads.js --entity authority --round-trip` from `migrations/` against localhost `pbdb`, and record the result. Expected: 163,067 heads, 0 violations, 0 differences.
- [x] 0.2 Run `npm test` and `npm run test:integration` at the root, and record that both pass.

## 1. Annotations and variants (`payloadSchemas/`)

- [x] 1.1 Remove `assertRootOnlyReadOnly` from `lib/variants.js`, so that `in-create` drops nested `readOnly` properties and prunes them from their node's `required` (D2)
- [x] 1.2 In `out`, make every property carrying `x-link` accept `null` as well, leaving the other variants unchanged (D4)
- [x] 1.3 Add `x-link` to `ANNOTATION_KEYWORDS` in `lib/ajv.js`
- [x] 1.4 Add `lib/links.js` exporting `link({ target, label })`, which returns the property schema in the spec's table (D1)
- [x] 1.5 Unit-test 1.1–1.4 in `tests/variants.test.js`:
  - nested read-only derives in every variant;
  - `in-create` rejects `/reference/title`;
  - `patch-guard` is unchanged;
  - `out` accepts `null` for a link and `in-create` rejects it;
  - the link object rejects undeclared keys.

## 2. Codec context and storage (`payloadSchemas/lib/storage.js`)

- [x] 2.1 `checkSource` accepts the optional `payload` and `labels` keys, applies the identifier check to both, and rejects `labels` without `payload` (D3)
- [x] 2.2 `collectCodecSources` attaches `labels: [x-link.label]` for a codec property carrying `x-link`. It still dedups on `table`, `key` and `value`, and merges the label lists.
- [x] 2.3 `loadCodecContext` selects each label as `"<payload>"->>'<label>'` and `removed` alongside `key` and `value`, and fills `labels`, with NULL labels left out. It also fills `removed` for versioned sources. Removed heads stay in `byKey` and `byValue`.
- [x] 2.4 `mergeNode` and `splitNode` pass `{ ...storage, link: prop['x-link'] }` to a single-property codec group whose property carries `x-link`
- [x] 2.5 Add `storageColumns(source)`
- [x] 2.6 Unit-test 2.1–2.5 in `tests/storage.test.js` with a fake pg: the label SQL, the `removed` set, the label merge on dedup, and `storageColumns` for authority and collection

## 3. Authority source and `referencePermid`

- [x] 3.1 In `authority.schema.js`, declare `reference` as `{ ...link({ target: 'references', label: 'title' }), 'x-storage': { column: 'reference_id', codec: 'referencePermid' } }`, and update the header comment
- [x] 3.2 In `lib/codecs.js`, add `payload: 'reference'` to `REFS_SOURCE`. Rewrite `referencePermid` merge and split as the spec says:
  - merge gives an object, `{ permid }` when there is no label, and `null` when the reference is removed;
  - split reads `.permid` and throws on a removed reference;
  - unknown ids and permids still throw.
- [x] 3.3 Update the authority cases in `tests/sources.test.js` and `tests/storage.test.js`:
  - create bodies send `reference: { permid }`;
  - `in-create` rejects a string, `{}` and `title`;
  - cover merge with a title, without one, and with a removed reference;
  - split ignores the label;
  - the removed-permid split throws.
- [x] 3.4 Confirm that `referenceList` and the collection and schema tests pass unchanged

## 4. API repository and hydration (`api/`)

- [x] 4.1 In `src/lib/resource-tables.js`, give the authorities descriptor `source: authoritySource` and remove its `links`
- [x] 4.2 In `src/lib/repository.js`, when the descriptor has a `source` (D5):
  - select `permid`, the payload and `storageColumns(source)`, with no link projections;
  - after the head query, load one codec context restricted through `codecKeyColumns` to the rows' keys;
  - build each record with `merge()`. This applies to `readHead` and `readHeads` alike.
- [x] 4.3 In `src/lib/link-hydration.js`, add `hydrateSourceLinks(record, source, prefix)`. It adds `href` to each non-null root `x-link` value with a `permid`, through `groupBase` (D6).
- [x] 4.4 In `src/lib/crud-routes.js`, accept `source` and hydrate with `hydrateSourceLinks` when it is present. In `routes/api/v1/authorities/`, pass the source and replace the stub with a source-shaped payload (D8).
- [x] 4.5 Update the existing unit tests that assume the authorities SQL sub-select or the old stub. These are in `test/link-enrichment.test.js` and `test/repository.test.js`, and any others the suite turns up.

## 5. Contract tests

- [x] 5.1 Add an `api/test/` suite that compiles the authority `out` with `createAjv()`. With a fake pg, it validates `data` for the single, list, `ids` and stub reads. The cases are a titled reference, an untitled one and a removed one (D7).
- [x] 5.2 In `test/integration/reads.test.js`:
  - give the authority fixtures source-valid payloads, replacing `{ taxonName }`;
  - validate the single and list responses against `out`;
  - add an authority citing a soft-removed ref, which reads as `reference: null`;
  - add one citing an untitled ref, which reads without a `title` key;
  - keep the swing-trigger case, in which the title follows a new reference version.

## 6. Verify and record

- [x] 6.1 Run `npm test` and `npm run test:integration` at the root; both must pass
- [x] 6.2 Re-run the 0.1 audit. It must match the baseline: 0 violations and 0 differences, now with `out` validating the link object.
- [x] 6.3 Read an authority from the running API on localhost (`npm start -w api`) and check the response by eye: `reference` is `{ title, permid, href }`, `legacyIDs` is present, and no `reference_id` appears
- [x] 6.4 Update `api/docs/response-contracts.md`:
  - status: design A is being built, with authorities as the pilot;
  - §7: close question 1, record Q2 as no `x-out` field and Q5 as plain paths.
  
  Update the "API responses vs. the `out` variants" backlog entry to match.
- [x] 6.5 Update `api/CLAUDE.md` where it describes reads and links, if it no longer matches
