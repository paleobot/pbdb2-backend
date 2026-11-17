## 1. Shared DOI code (`src/refs-migration/dois.js`)

- [x] 1.1 `normalizeDoi` and `isWellFormedDoi` (D2), with tests covering each prefix, case kept, a SICI DOI, a 3-digit prefix, embedded spaces, a handle URL, free text and `-`
- [x] 1.2 `tokens` and `score` (markup, accents, words under 3 letters, empty sets), with the spec's scenarios as tests
- [x] 1.3 Exported threshold constants and `verdictFor(ref, resolution)` implementing rules 1–8, with tests for each rule, including "same journal, other article" → `wrong`, and the Hall 1866 case
- [x] 1.4 Verdict-file write (via `csvField`, sorted, fixed header) and read (an RFC-4180 parser for quoted fields, doubled quotes, commas and newlines), with a round-trip test using commas, quotes and non-ASCII titles; reading a file with a wrong header throws

## 2. Audit script (`src/refs-migration/audit-dois.js`)

- [x] 2.1 Read refs with a non-blank trimmed `doi` (`reference_no`, `doi`, `reftitle`, `pubtitle`, `pubyr`) through `src/lib/mariadb-pool.js`, and the existing verdict file when present
- [x] 2.2 Resolver: Crossref → handle API → doi.org CSL (D3), with the metadata extracted into one shape and `encodeURIComponent` for the DOI. `fetch` is injectable for tests
- [x] 2.3 Request pacing and retries: sequential, at most 4/s, `Retry-After` or backoff from 2 s on 429/503, 5 retries on network errors and 5xx, exhaustion → `failed`. The generic User-Agent goes on every request. Tested with a fake `fetch`, including the check that no request carries an email address
- [x] 2.4 Incremental selection (missing or stale `source_doi`), pruning rows whose ref has no DOI, a once-per-DOI cache, and an atomic rewrite every 500 resolved DOIs and at the end
- [x] 2.5 `--all` and `--rescore` (no network; recompute from stored `registered_*`), and the end-of-run log (counts per verdict, `failed`, requests)
- [x] 2.6 Smoke run on a limited set (an env or flag limit used only for this check; dropped afterwards if no lasting need) against the proposal's examples: Hall 1866 → `wrong`, a BHL DOI → `match`, a DataCite DOI → source `doi.org`, a 404 DOI → `unresolvable`

## 3. Full audit and threshold check

- [ ] 3.1 Run the audit over all Classic DOIs on `pbdb_2026_10_18` (about 3 h; resume if interrupted). Record the verdict counts, `failed` (re-run until 0 or explained) and the elapsed time
- [ ] 3.2 Compare the verdict rates per Classic type with the proposal's estimates, and explain any large gap
- [ ] 3.3 Draw the D7 sample in scratch (100 `wrong`, 50 `related-work`, 50 `uncertain`, 25 `part-or-container`) and hand it to the user for checking
- [ ] 3.4 Apply the user's findings: adjust constants if needed, `--rescore`, re-check the affected rows, and record the outcome in design.md (Open Questions → decision)
- [ ] 3.5 Check that a second incremental run makes 0 requests and leaves the file byte-identical

## 4. Refs migration

- [x] 4.1 Load `inputs/doi-verdicts.csv` at startup, resolved from the script's location; abort on a missing or unparseable file
- [x] 4.2 Export a pure `doiFor(ref, verdictRow)` returning `{ doi, outcome }` per the spec table, and use it in `buildJsonb` in place of the trim
- [x] 4.3 Run summary: verdict-file row count; normalized count; kept and dropped counts per outcome; a warning with unaudited counts and the first 20 `reference_no`s
- [x] 4.4 Tests in `src/tests/refs-transforms.test.js`: prefixed + `match`, `wrong`, `malformed`, `uncertain`, no row, stale row, unaudited `-`, blank DOI; update the existing tests that build jsonb with a DOI
- [x] 4.5 Declare `src/refs-migration/inputs/doi-verdicts.csv` in the `refs` step's `inputs` in `src/run-migrations.js`, and check that preflight fails naming it when it is renamed away

## 5. Docs and config

- [x] 5.1 `migrations/src/README.txt`: how to run the audit (modes, about 3 h, no contact details sent), and that a new dump needs an incremental audit + `--rescore` + a commit before migrating
- [x] 5.2 Add `classic-doi-audit` to the migration spec-path list in `openspec/config.yaml`
- [x] 5.3 `npm test` passes at the root

## 6. Re-migrate localhost and verify

- [ ] 6.1 Rebuild localhost `pbdb` with the full runner (`--createdb`). Keep the log
- [ ] 6.2 Confirm that every step's totals other than the DOI counts match the previous run, and that `refs` has the same row count
- [ ] 6.3 Confirm in SQL: PBDB refs with `reference ? 'doi'` = the summary's kept total, no stored DOI matches a prefix (`^(doi:|https?://|dx\.|\^)`), and the sum in the summary equals the refs with a non-blank source DOI
- [ ] 6.4 Confirm via the API that `doi=` with the Hall 1866 *Lancet* DOI returns no PBDB ref, and a kept DOI still returns its ref
- [ ] 6.5 Rollback check: note in the commit message that reverting the migration change and re-running restores the previous DOIs; the verdict file can stay
