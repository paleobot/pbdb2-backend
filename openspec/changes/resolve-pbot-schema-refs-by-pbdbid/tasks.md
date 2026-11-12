## 1. Baseline

- [ ] 1.1 Record the 2026-11-10 localhost run as the baseline: the `pbot-schemas` summary (`fetched=10, inserted=8, skipped=2`; characters 344 fetched, 336 inserted, 8 orphans; states 1,327 fetched, 1,325 inserted, 2 orphans; 1 additional schema ref) and every other step total from `run-migrations.log`.
- [ ] 1.2 Confirm the current token still sees the two private test schemas (`944ca300…`, `42b8ec19…`) and that their primary reference `de299345…` has `pbdbid` 68934. If the test data has been cleaned up meanwhile, note that the live check in 4.x falls back to the unit tests alone.

## 2. Resolver (D1, D2)

- [ ] 2.1 In `migrations/src/pbot-schemas-migration/migrate-pbot-schemas.js`, run `main()` only when the script is invoked directly, as `migrate-refs.js` does.
- [ ] 2.2 Add `pbdbid` and `title` to the Reference selection in the Schema query.
- [ ] 2.3 Add a `refs` lookup by `reference->'legacyIDs'->>'oldpbdbID'` that returns the id and the title.
- [ ] 2.4 Add and export `resolveReference(reference, { byPbotID, byPbdbID })` returning `{ id, via, classicTitle }`: `pbotID` first, then the trimmed non-blank `pbdbid`, otherwise `{ id: null, via: null }`.
- [ ] 2.5 Use it for the primary reference and for each additional reference. Unresolved warnings name the `pbdbid` when non-blank; the skip behaviour is unchanged.

## 3. Logging (D3)

- [ ] 3.1 Log one line per `pbdbid` resolution with the schema `pbotID`, reference `pbotID`, `pbdbid`, PBot title and Classic title, and count primary and additional resolutions.
- [ ] 3.2 Add `Refs via pbdbid: primary=<n>, additional=<m>` after `Additional refs:` in the summary. Leave the Schemas, Characters and States lines unchanged, and check that `src/tests/pbot-schemas-summary.test.js` still passes.

## 4. Tests and verification

- [ ] 4.1 Add `migrations/src/tests/pbot-schemas-refs.test.js` (`node:test`) with fake lookups covering: resolved by `pbotID`; resolved by `pbdbid` (trimmed); `pbotID` takes precedence over `pbdbid`; blank or NULL `pbdbid` is not looked up; dangling `pbdbid` returns no id.
- [ ] 4.2 `npm test` passes in `migrations/`.
- [ ] 4.3 Drop, recreate and fully re-migrate localhost `pbdb` with `node src/run-migrations.js --createdb`. The runner reports "success — 11 step(s) completed, audit clean".
- [ ] 4.4 Compare with the 1.1 baseline:
  - `pbot-schemas`: schemas fetched=10, inserted=10, skipped=0; characters 344 inserted, 0 orphans; states 1,326 inserted, 1 orphan (`ed088383`, the PBot self-parent state); `Refs via pbdbid: primary=2, additional=0` (or as measured).
  - The log has a resolution line for each test schema showing "Ref-ddm-08-25a" beside the title of Classic ref 68934.
  - Both test schemas have `reference_id` = the `refs.id` of `oldpbdbID` 68934.
  - No `refs` row has both `legacyIDs.pbotID` and `legacyIDs.oldpbdbID`.
  - Every other step total equals the baseline.

## 5. Close-out

- [ ] 5.1 If the measured counts differ from 4.4, record the measured values in the tasks notes and correct the spec scenarios if one states a count.
- [ ] 5.2 Rollback check, written down and not run: revert the commit, rebuild, and the runner fails at `pbot-schemas` with `skipped=2`, as in the baseline (while the token still sees the test schemas).
- [ ] 5.3 Record that Aurora `pbdb2_migration_test` picks this up at its next scheduled rebuild.
