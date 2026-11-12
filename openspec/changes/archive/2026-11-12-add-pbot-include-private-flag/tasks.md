## 1. Shared PBot access (D2, D3)

- [x] 1.1 `migrations/src/lib/pbot.js` exports `PBOT_GRAPHQL_URL`, `PBOT_INCLUDE_PRIVATE_FLAG`, `includePrivateRequested(argv)`, `pbotToken()`, `pbotHeaders(useToken)` (throws naming `PBOT_TOKEN` when `useToken` and no token) and `pbotAccessLabel(includePrivate)`. It reads `process.env` at call time.
- [x] 1.2 `migrations/src/tests/pbot-access.test.js`: `pbotToken` trims and treats unset, empty and whitespace-only as `null`; `pbotHeaders(false)` has no Authorization even with a token set; `pbotHeaders(true)` gives `Bearer <trimmed>`; `pbotHeaders(true)` with no token throws; `includePrivateRequested` detects the flag; both labels.

## 2. The three PBot steps (D2)

- [x] 2.1 `migrate-pbot-persons.js`: always `pbotHeaders(true)`, and log `PBot access: token (person emails are not public)`. Check the token before fetching, so a missing token exits non-zero before any write. No local URL constant.
- [x] 2.2 `migrate-pbot-refs.js`: `pbotHeaders(includePrivateRequested())`. Log `PBot access: <label>` and check the token before fetching when the flag is given.
- [x] 2.3 `migrate-pbot-schemas.js`: same rule for the Schema, Character and State fetches. Log once before the first fetch.

## 3. Runner (D4)

- [x] 3.1 `parseArgs` accepts `--pbot-include-private`. The usage comment and the "Valid flags" message list it.
- [x] 3.2 `validateArgs` (after selection) rejects the flag when neither `pbot-refs` nor `pbot-schemas` is selected.
- [x] 3.3 Registry: `pbot-refs` and `pbot-schemas` get `env: ['PG']` and `pbotRecords: true`. `ENV_GROUPS.PBOT` is `['PBOT_TOKEN']`. Preflight adds `PBOT` for `pbotRecords` steps only when the flag is given, and appends `— PBot records: <label>` to the environment line when a `pbotRecords` step is selected.
- [x] 3.4 `runStep` passes `--pbot-include-private` to `pbotRecords` steps only, when given. Remove the first attempt's `pbot` run-log header line.
- [x] 3.5 `npm test` passes in `migrations/`.

## 4. Docs

- [x] 4.1 `.env.example`: `PBOT_TOKEN` is required by `pbot-persons` (person emails) and, with `--pbot-include-private`, by `pbot-refs` and `pbot-schemas`.
- [x] 4.2 `migrations/src/README.txt`: describe `--pbot-include-private` and the token, and add the flag to the run command examples if they list flags.

## 5. Verification

- [x] 5.1 The user restores `PBOT_TOKEN` in `.env`.
- [x] 5.2 `node src/run-migrations.js --from authorities --pbot-include-private` exits non-zero before connecting, with the explanatory message.
- [x] 5.3 Drop, recreate and fully re-migrate localhost `pbdb` with `node src/run-migrations.js --createdb` (no flag). The runner reports "success — 11 step(s) completed, audit clean".
- [x] 5.4 Preflight reports `PBot records: anonymous, public records only`; `pbot-refs` and `pbot-schemas` log the same; `pbot-persons` logs `token (person emails are not public)`.
- [x] 5.5 Compare with the 2026-11-12 token run (`27016b4`):
  - pbot-persons +71 (persons 1,401) and pbot-refs +244 (refs 96,122), unchanged.
  - `pbot-schemas`: Schemas fetched=8, inserted=8, skipped=0; Characters 336, 0 orphans; States fetched=1,326, inserted=1,325, 1 orphan (`ed088383`); `additional_schema_refs` 1; `Refs via pbdbid: primary=0, additional=0`; no resolution lines; no `schemas` row titled `Schema-ddm-%`.
  - Every non-PBot step total equals the 2026-11-12 run.
- [x] 5.6 If measured counts differ (PBot's public data is live), record the measured values here and explain the difference.

## 6. Close-out

- [x] 6.1 Rollback, written down and not run: revert the commit. The steps return to their previous token handling, and the runner again requires `PBOT_TOKEN` for all three PBot steps.
- [x] 6.2 Record that Aurora `pbdb2_migration_test` picks this up at its next scheduled rebuild, public only unless that rebuild is run with `--pbot-include-private`.

## Notes

**First attempt (2026-11-12), token optional for every step:** the change was first planned as `make-pbot-token-optional`, where unset `PBOT_TOKEN` made all three steps anonymous. Its anonymous rebuild (`run-migrations.log`, 21:56) failed at `pbot-persons`: "Fetched 325 persons… Filtered out 325 persons without email", with persons 1,330 → 1,330. Anonymous access returns `Person.email` as null. A field-by-field comparison of token and anonymous results, over records both return, showed:
- Person: `email` differs on 96.
- Reference: `enteredBy.Person.email` differs on all 291 (requested, never read).
- Schema, Character, State: no differences.

The user chose a runner flag (`--pbot-include-private`, so named because the run includes private records alongside public ones) over an `.env` switch. The change was renamed to `add-pbot-include-private-flag`.

**5.2 (2026-11-12):** `--from authorities --pbot-include-private` exits 1 before connecting: "--pbot-include-private affects only pbot-refs and pbot-schemas, and neither is selected. Omit it to run these steps."

**5.3–5.5 measured (2026-11-12 22:05 localhost rebuild, `--createdb`, no flag, "success — 11 step(s) completed, audit clean"):** preflight `PBot records: anonymous, public records only`. `pbot-refs` and `pbot-schemas` log the same, and `pbot-persons` logs `token (person emails are not public)`. All totals are as expected:
- pbot-persons +71 (persons 1,401) and pbot-refs +244 (refs 96,122).
- `pbot-schemas`: Schemas 8/8/0; Characters 336/336, 0 orphans; States 1,326 fetched, 1,325 inserted, 1 orphan; `additional_schema_refs` 1; `Refs via pbdbid: primary=0, additional=0`, no resolution lines; 0 `Schema-ddm-%` rows.
- Every non-PBot total equals the 2026-11-12 token run: authorities 166,992; name_opinions 782,423; assignment_opinions 944,933; validity_opinions 11,467; collections 279,599; additional_collection_refs 441,514; specimens 167,855; taxa 525,805 (clades 3,346, attachments 20,264).

No differences to explain (5.6).

**6.1 Rollback (not run):** reverting the commit restores the previous handling. `pbot-persons` and `pbot-schemas` always send the token, `pbot-refs` never does, and the runner requires `PBOT_TOKEN` for all three PBot steps.

**6.2 Aurora:** `pbdb2_migration_test` was not rebuilt for this change. Its next scheduled rebuild picks it up, public only unless run with `--pbot-include-private`.
