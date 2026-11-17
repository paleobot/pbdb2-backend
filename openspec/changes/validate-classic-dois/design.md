## Context

`migrate-refs.js` copies Classic `refs.doi` into `reference.doi` after a trim. The proposal measured about 4% of the 46,812 DOIs as pointing to another work, and showed they can't be caught from the Classic row alone: 158 of 160 wrong DOIs agree with the ref's surname and year. Only the registered title tells them apart, so checking needs network lookups. The migration must stay offline and deterministic.

Current state that shapes the design:
- A file a migration reads at run time lives in `<migration>/inputs/` and is declared in the runner step's `inputs` for preflight (`migration-script-layout`, `migration-runner`). The only declared input today is the opinions worklist.
- `src/refs-migration/` already writes one committed CSV (`single-title-books-review.csv`) using `csvField` from `src/lib/anomaly-log.js`. There is no CSV reader in `migrations/`.
- The audit needs MariaDB only. `src/lib/mariadb-pool.js` connects to MariaDB alone, while `src/lib/db.js` also opens PostgreSQL.
- The API `doi` filter strips `doi:` and resolver prefixes and compares case-insensitively, so it needs no change.
- The memory rule for this project: send no user contact details to outside services. Crossref's polite pool wants a `mailto`, so the audit uses the public pool.

## Goals / Non-Goals

**Goals:**
- One offline audit that gives every Classic DOI a verdict and records the registered metadata behind it.
- A committed verdict file the refs migration reads, with no network calls in the migration.
- Verdicts that can be recomputed offline when the thresholds change, and an audit run that can stop and resume.
- Normalized DOIs in pbdb2, and wrong ones dropped, with counts in the run log.

**Non-Goals:**
- Repairing DOIs: no space removal, no trailing-punctuation fixes, no lookup of a correct DOI for a ref.
- Changing Classic, or sending the report upstream (separate from this change).
- PBot refs.
- A curator override mechanism beyond editing the committed CSV.
- Running the audit as a runner step.

## Decisions

### D1. Files and where they live

| File | Role |
|---|---|
| `src/refs-migration/dois.js` | Pure code shared by the audit and the migration: normalize, syntax check, tokenize and score, verdict, CSV read and write. |
| `src/refs-migration/audit-dois.js` | The audit: reads MariaDB, calls Crossref and doi.org, writes the verdict file. |
| `src/refs-migration/inputs/doi-verdicts.csv` | The verdict file. Committed. Declared as an input of the runner's `refs` step. |
| `src/tests/doi-audit.test.js` | Unit tests for `dois.js` and the audit's HTTP handling with a fake `fetch`. |

The audit sits beside the migration because it reads Classic refs and writes that migration's input; nothing else uses it. It is not named `migrate-*.js`, so it can't be taken for a migration entry point, and it stays out of the migration inventory. Its tests go in `src/tests/` beside `refs-transforms.test.js`, because that is the directory `npm test` globs.

The shared code stays in `refs-migration/` and not in `src/lib/`: both callers are in this directory, so no cross-migration import arises.

*Alternative:* the CSV at the directory root beside `migrate-refs.js`, as the proposal said. Rejected: `migration-script-layout` puts run-time inputs in `inputs/` so they sit apart from regenerated outputs like the review list.

### D2. Normalization and syntax

`normalizeDoi(s)` trims and then repeatedly removes a leading `doi:` (any case, optional whitespace), `http(s)://`, `dx.doi.org/`, `doi.org/` or `^`. Case and everything else stay as they are. DOIs are case-insensitive, and the API filter already ignores case.

A normalized string is well formed when it matches `^10\.\d{4,9}/\S+$`. Anything else is `malformed`: the broken `10.`-strings (3-digit prefixes, embedded spaces), handles, JSTOR and PDF URLs, and free text. The syntax check is deliberately loose. A truncated DOI that is still well formed is caught by resolution (`unresolvable`).

A DOI counts as *normalized* in the run summary when a prefix was removed. Trimming alone doesn't count.

### D3. Resolution

For each distinct normalized, well-formed DOI (fetched once, even when refs share it):
1. `GET https://api.crossref.org/works/{doi}`. A 200 gives metadata from `title` + `subtitle`, `container-title`, the year of `issued` (else `published`), and the first author's `family` (else `name`). Source: `crossref`.
2. On 404, `GET https://doi.org/api/handles/{doi}`. `responseCode` 100 means the DOI is not registered: `unresolvable`, source `none`.
3. If the handle exists, `GET https://doi.org/{doi}` with `Accept: application/vnd.citationstyles.csl+json`. A CSL-JSON body gives the same fields (`title`, `container-title`, `issued`, `author[0]`). Source: `doi.org`. Any other response, such as an HTML landing page from an agency without content negotiation, gives source `handle`: the DOI exists but has no metadata.

Path segments are encoded with `encodeURIComponent` so SICI-style DOIs (`<`, `>`, `;`, `#`) survive.

**Etiquette:** `User-Agent: pbdb2-doi-audit/1.0`, with no `mailto` and no contact details. Requests are sequential (concurrency 1), at most 4 per second overall. A 429 or 503 waits for `Retry-After`, or backs off exponentially from 2 s when it is absent. A network error or other 5xx retries up to 5 times with backoff. When retries run out, the ref gets **no row** this run and is counted as `failed`. A transient failure never becomes `unresolvable`, which would drop a good DOI.

About 45,000 distinct DOIs at 4 per second is about 3 hours.

*Alternative:* the Crossref polite pool (`mailto`, 10 per second, concurrency 3). Rejected: it needs a contact address.

### D4. Scoring and verdicts

`tokens(s)`: strip markup tags (`<i>`, `<scp>`), NFKD-decompose and drop combining marks, lowercase, split on non-letters, and keep words of 3+ letters as a set.
`score(a, b) = |A ∩ B| / min(|A|, |B|)`, and 0 when either set is empty. This is the token containment used in the exploration.

Inputs from the ref: `reftitle`, `pubtitle` and `pubyr` (its first 4-digit run). `refTitle` is `reftitle` when non-blank, else `pubtitle`.

The verdict is the first rule that applies:

| # | Condition | Verdict |
|---|---|---|
| 1 | normalized string not well formed | `malformed` |
| 2 | not registered | `unresolvable` |
| 3 | registered but no metadata (source `handle`), or the ref has no title, or the registered title is blank | `uncertain` |
| 4 | T = score(refTitle, registered title) ≥ **0.6**, and the years agree | `match` |
| 5 | T ≥ 0.6, and the years disagree | `related-work` |
| 6 | C ≥ **0.6**, where C is the higher of score(`pubtitle`, registered title) (only when `reftitle` is non-blank) and score(`reftitle`, registered container title) | `part-or-container` |
| 7 | max(T, C) ≥ **0.3** | `uncertain` |
| 8 | otherwise | `wrong` |

The years agree when either year is missing or they differ by at most **1**.

The registered container title is never compared with the ref's `pubtitle`. A different article in the right journal shares its container, so that comparison would turn the commonest wrong case into `part-or-container`.

Author agreement is not used. It agreed on 158 of the 160 wrong DOIs, and it fails on corporate authors (IODP "Expedition 3xx Scientists").

The constants (0.6, 0.3, 1) are exported from `dois.js` in one place. They are provisional until the hand-checked sample (D7).

### D5. The verdict file

UTF-8 CSV, one row per Classic ref whose `doi` is non-blank, sorted by `reference_no`. It is written with `csvField`, so a field is quoted when it contains `"`, `,` or a newline. Header:

`reference_no,source_doi,doi,verdict,score,source,registered_title,registered_container,registered_year,registered_first_author`

- `source_doi`: the Classic value, trimmed.
- `doi`: the normalized value; blank for `malformed`.
- `score`: T to two decimals; blank where no comparison ran (rules 1–3).
- `source`: `crossref`, `doi.org`, `handle` or `none`; blank for `malformed`.
- The `registered_*` fields are blank when there is no metadata.

The file holds nothing that varies between runs (no timestamps), so unchanged inputs rewrite it byte for byte. Estimated size is about 8 MB. That is acceptable in git, and the diffs stay line-sized because rows are stable.

The registered metadata is kept on every row, `match` included. That is what makes offline rescoring possible (D6), and a curator can check any verdict without a lookup.

*Alternative:* JSON lines. Rejected: curators and the upstream report want a spreadsheet.

### D6. Audit modes and resumability

`node src/refs-migration/audit-dois.js [--all | --rescore]`

- **Default (incremental):** read every Classic ref with a non-blank `doi` and the existing file. A ref is audited when it has no row, or when its row's `source_doi` differs from the current trimmed value. Other rows are kept as they are. Rows whose ref no longer has a DOI are removed. The file is rewritten atomically (temp file + rename) every 500 resolved DOIs and at the end. An interrupted run therefore loses at most 500 lookups, and re-running resumes it. The first run is the incremental run on an empty file.
- **`--all`:** re-resolve every DOI.
- **`--rescore`:** make no network calls. Recompute `verdict` and `score` for every row that has metadata, from its stored `registered_*` fields and the current ref fields. This is how threshold changes are applied.

Hand edits to `verdict` survive incremental runs, since unchanged rows are not touched. `--all` and `--rescore` overwrite them, and the git diff shows that. This is the only override, for now.

At the end the audit logs the count per verdict, `failed`, and the number of HTTP requests.

### D7. Threshold validation before committing the file

After the first full run, a stratified random sample is drawn in scratch: 100 `wrong`, 50 `related-work`, 50 `uncertain` and 25 `part-or-container`. The user hand-checks it. The bar is no false `wrong` and no false `related-work`, because those drop good DOIs. Any misses lead to adjusting the constants, `--rescore`, and re-checking the affected rows. The sample and its results go into the change's notes, not into the repo.

### D8. Migration behavior

At startup, before reading refs, `migrate-refs.js` reads `inputs/doi-verdicts.csv` into a map keyed by `reference_no`. A missing or unparseable file aborts the run. The runner's preflight catches a missing file earlier, because the `refs` step declares it as an input.

For each ref with a non-blank `doi`:

| Case | `reference.doi` | Counted as |
|---|---|---|
| A row exists, its `source_doi` equals the trimmed source, and the verdict is `match`, `part-or-container` or `uncertain` | normalized DOI | kept, by verdict |
| Same, and the verdict is `wrong`, `related-work`, `unresolvable` or `malformed` | omitted | dropped, by verdict |
| No row, or a stale `source_doi`, and the normalized DOI is well formed | normalized DOI | `unaudited` (kept) |
| No row, or a stale `source_doi`, and the normalized DOI is malformed | omitted | `unaudited-malformed` (dropped) |

The kept value is always the migration's own `normalizeDoi`, not the file's `doi` column, so one function decides the stored string.

**Missing or stale verdicts keep the DOI.** About 96% of DOIs are right, and keeping them is what the migration does today. Failing the run would block every new dump until the audit is re-run. The run log warns with the count and lists the first 20 `reference_no`s, so the fix is clear: run the incremental audit, commit, and re-run the migration.

*Alternatives:* dropping unaudited DOIs throws away mostly good links; failing the run is too strict for a one-off migration.

The run summary adds: the number normalized; kept per verdict; dropped per verdict; `unaudited` and `unaudited-malformed`. No anomaly ledger is written, since the verdict file already records every dropped DOI with its reason.

### D9. Re-migration and verification

Localhost is rebuilt with the full runner. Expected results:
- `refs` row count and every other step's totals are unchanged.
- The count of PBDB refs with a `doi` equals the kept total from the summary.
- No stored DOI starts with a prefix.
- The API's `doi` filter no longer returns the proposal's examples (the Hall 1866 *Lancet* DOI).

Aurora `pbdb2_migration_test` is rebuilt later, outside this change.

## Risks / Trade-offs

- [False `wrong` from cross-language titles] → Rule 6 and the uncertain band between 0.3 and 0.6 keep borderline cases. D7's hand check is the gate before the file is committed, and `--rescore` makes changing thresholds cheap.
- [Metadata changes at Crossref between runs] → Verdicts reflect the run date. Only `--all` refreshes them. That is acceptable for a one-off migration.
- [A ref's title edited in Classic while its DOI stays the same] → Its verdict is not recomputed by the incremental run. `--rescore` recomputes it from stored metadata at no network cost, and should be run before each new dump's migration.
- [Rate limits change or Crossref throttles] → Sequential requests, Retry-After handling, and resumable checkpoints. A throttled run is slower, not wrong.
- [Hand edits lost to `--all`/`--rescore`] → The git diff shows them. No dedicated override column until a curator actually needs one.
- [An 8 MB committed CSV] → Rows are stable, so diffs are small. It is deleted with `migrations/` when Classic retires.
- [Unaudited DOIs kept] → They are logged with a count and examples. The 4% base rate bounds the harm.

## Migration Plan

1. Implement `dois.js`, the audit and the tests. Run the audit (about 3 hours, resumable).
2. Do D7's hand check, adjust if needed, `--rescore`, and commit `inputs/doi-verdicts.csv`.
3. Change `migrate-refs.js` and declare the input in `run-migrations.js`.
4. Rebuild localhost with the full runner and verify (D9).

Rollback: revert the migration commit and re-run. The verdict file can stay; nothing reads it without the migration change.

## Open Questions

- The thresholds are provisional until D7's hand check.
