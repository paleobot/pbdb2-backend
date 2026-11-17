## 1. Rename

- [x] 1.0 Before any edit, run `node src/audit-payloads.js --entity collection --entity schema --round-trip` from `migrations/` against localhost `pbdb`, and record the result as the baseline
- [x] 1.1 In `payloadSchemas/collection.schema.js`, rename the `references[]` item property and its `required` entry from `referenceID` to `permid`, keeping its description
- [x] 1.2 Make the same rename in `payloadSchemas/schema.schema.js`
- [x] 1.3 In `referenceList` (`payloadSchemas/lib/codecs.js`), read `permid` from each item on split, write `permid` on merge, and update the comment that names the key
- [x] 1.4 Update `payloadSchemas/tests/storage.test.js` and `sources.test.js` to the new key. Add a `sources.test.js` case where `in-create` rejects `{ referenceID, order }` for the missing `permid`, for both collection and schema

## 2. Verify

- [x] 2.1 `npm test` passes at the repository root
- [x] 2.2 `grep -rn referenceID` outside `openspec/changes/` and `node_modules/` finds only the spec text naming the old key, the 1.4 rejection test, and historical mentions in docs (`api/docs/response-contracts.md` §4, the "API responses vs. the `out` variants" comparison in `docs/api-design-backlog.md`)
- [x] 2.3 Re-run the 1.0 audit and confirm it matches the baseline: the same `db` failures and round-trip differences, expected to be zero
