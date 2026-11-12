## 1. Baseline

- [x] 1.1 Record the 2026-11-10 localhost run as the baseline: the `pbot-schemas` summary (`fetched=10, inserted=8, skipped=2`; characters 344 fetched, 336 inserted, 8 orphans; states 1,327 fetched, 1,325 inserted, 2 orphans; 1 additional schema ref) and every other step total from `run-migrations.log`.
- [x] 1.2 Confirm the current token still sees the two private test schemas (`944ca300…`, `42b8ec19…`) and that their primary reference `de299345…` has `pbdbid` 68934. If the test data has been cleaned up meanwhile, note that the live check in 4.x falls back to the unit tests alone.

## 2. Resolver (D1, D2)

- [x] 2.1 In `migrations/src/pbot-schemas-migration/migrate-pbot-schemas.js`, run `main()` only when the script is invoked directly, as `migrate-refs.js` does.
- [x] 2.2 Add `pbdbid` and `title` to the Reference selection in the Schema query.
- [x] 2.3 Add a `refs` lookup by `reference->'legacyIDs'->>'oldpbdbID'` that returns the id and the title.
- [x] 2.4 Add and export `resolveReference(reference, { byPbotID, byPbdbID })` returning `{ id, via, classicTitle }`: `pbotID` first, then the trimmed non-blank `pbdbid`, otherwise `{ id: null, via: null }`.
- [x] 2.5 Use it for the primary reference and for each additional reference. Unresolved warnings name the `pbdbid` when non-blank; the skip behaviour is unchanged.

## 3. Logging (D3)

- [x] 3.1 Log one line per `pbdbid` resolution with the schema `pbotID`, reference `pbotID`, `pbdbid`, PBot title and Classic title, and count primary and additional resolutions.
- [x] 3.2 Add `Refs via pbdbid: primary=<n>, additional=<m>` after `Additional refs:` in the summary. Leave the Schemas, Characters and States lines unchanged, and check that `src/tests/pbot-schemas-summary.test.js` still passes.

## 4. Tests and verification

- [x] 4.1 Add `migrations/src/tests/pbot-schemas-refs.test.js` (`node:test`) with fake lookups covering: resolved by `pbotID`; resolved by `pbdbid` (trimmed); `pbotID` takes precedence over `pbdbid`; blank or NULL `pbdbid` is not looked up; dangling `pbdbid` returns no id.
- [x] 4.2 `npm test` passes in `migrations/`.
- [x] 4.3 Drop, recreate and fully re-migrate localhost `pbdb` with `node src/run-migrations.js --createdb`. The runner reports "success — 11 step(s) completed, audit clean".
- [x] 4.4 Compare with the 1.1 baseline:
  - `pbot-schemas`: schemas fetched=10, inserted=10, skipped=0; characters 344 inserted, 0 orphans; states 1,326 inserted, 1 orphan (`ed088383`, the PBot self-parent state); `Refs via pbdbid: primary=2, additional=0` (or as measured).
  - The log has a resolution line for each test schema showing "Ref-ddm-08-25a" beside the title of Classic ref 68934.
  - Both test schemas have `reference_id` = the `refs.id` of `oldpbdbID` 68934.
  - No `refs` row has both `legacyIDs.pbotID` and `legacyIDs.oldpbdbID`.
  - Every other step total equals the baseline.

## 5. Close-out

- [x] 5.1 If the measured counts differ from 4.4, record the measured values in the tasks notes and correct the spec scenarios if one states a count.
- [x] 5.2 Rollback check, written down and not run: revert the commit, rebuild, and the runner fails at `pbot-schemas` with `skipped=2`, as in the baseline (while the token still sees the test schemas).
- [x] 5.3 Record that Aurora `pbdb2_migration_test` picks this up at its next scheduled rebuild.

## Notes

**1.1 Baseline (2026-11-10, `run-migrations.log`; `--createdb` run failed at `pbot-schemas`, then `--from authorities`):** persons 1,330 + 71 (pbot-persons); refs 95,878 + 244 (pbot-refs); `pbot-schemas` Schemas fetched=10, inserted=8, skipped=2; Characters fetched=344, inserted=336, orphans=8; States fetched=1,327, inserted=1,325, orphans=2; additional_schema_refs 1; authorities 166,992; name_opinions 525,868 (authority-opinions) → 782,423 (+256,555 opinions); assignment_opinions 944,933; validity_opinions 11,467; collections 279,599; additional_collection_refs 441,514; specimens 167,855; taxa_linnaean 525,805; taxa_clades 3,346; taxa_attachments 20,264; taxa 525,805. Since then b531977 (book-chapter fix) changed `refs` content but not its row count by design. Compare `refs` row counts only.

**1.2 (2026-11-12):** the token still sees both test schemas. `944ca300…` cites `de299345…` (pbdbid 68934, "Ref-ddm-08-25a") once. `42b8ec19…` cites it **twice**, at order 1 and order 2, so its additional citation also resolves through pbdbid. Expected in 4.4: `Refs via pbdbid: primary=2, additional=1` and `additional_schema_refs` = 2 (the existing 1 + this one), not `additional=0`.

**5.2 Rollback (not run):** reverting the implementation commit restores the `pbotID`-only lookup. A rebuild then skips `944ca300…` and `42b8ec19…` again (`Schemas: fetched=10, inserted=8, skipped=2`), and the runner fails `pbot-schemas` output verification as on 2026-11-10, for as long as the token sees the test schemas. Nothing in `refs` needs undoing, because the change writes no `refs` row.

**5.3 Aurora:** `pbdb2_migration_test` was not rebuilt for this change. It picks this up at its next scheduled rebuild.

**4.3 / 4.4 / 5.1 measured (2026-11-12 21:11 localhost rebuild, "success — 11 step(s) completed, audit clean"):**
- `pbot-schemas`: Schemas fetched=10, inserted=10, skipped=0. Characters fetched=**342**, inserted=342, orphans=0. States fetched=1,327, inserted=1,326, orphans=1 (`ed088383`, the self-parent state). `additional_schema_refs` = **2**. `Refs via pbdbid: primary=2, additional=1`.
- Characters are 342 rather than 344 because PBot now returns 342. Two test characters were removed in PBot between 2026-11-10 and this run. The step inserted every character it fetched.
- `additional=1` and `additional_schema_refs` = 2 come from `42b8ec19…` citing `de299345…` at both order 1 and order 2 (see 1.2). The extra row has `reference_id` 68934, the same as the primary, which matches the "primary repeats" handling elsewhere.
- Three resolution lines appear in the log, each showing "Ref-ddm-08-25a" → "Macroevolutionary dynamics and historical biogeography of primate diversification inferred from a species supermatrix" (Classic 68934, unrelated, which confirms the stub `pbdbid`).
- Both test schemas have `reference_id` = 68934 (`oldpbdbID` 68934). 0 `refs` rows carry both `legacyIDs.pbotID` and `legacyIDs.oldpbdbID`.
- Every other step total equals the 1.1 baseline: persons 1,401; refs 96,122; authorities 166,992; name_opinions 782,423; assignment_opinions 944,933; validity_opinions 11,467; collections 279,599; additional_collection_refs 441,514; specimens 167,855; taxa 525,805 (linnaean 525,805, clades 3,346, attachments 20,264). Taxa rebuild took 396.4 s.
- No spec scenario states these counts, so the spec needs no correction.
