# classic-doi-audit Specification

## Purpose
Check every DOI on a Classic ref against its registration, offline and before migration. The audit resolves each DOI through Crossref, else doi.org, gives it a verdict from title, year and author agreement, and records the verdicts and the registered metadata in a committed file. The refs migration reads that file to keep or drop each DOI, so it makes no network call itself, and the file records every DOI pbdb2 did not keep.

## Requirements
### Requirement: Audit script and its files
The audit SHALL be the script `src/refs-migration/audit-dois.js`. It SHALL read Classic refs from MariaDB through `src/lib/mariadb-pool.js` and SHALL NOT connect to PostgreSQL. It SHALL write its verdicts to `src/refs-migration/inputs/doi-verdicts.csv`, a version-controlled file that SHALL NOT be gitignored. The normalization, syntax check, scoring, verdict rules, and CSV reading and writing SHALL live in `src/refs-migration/dois.js`, which the refs migration also imports. The audit is not a migration and not a runner step: it SHALL NOT be named `migrate-*.js` or added to the migration inventory.

#### Scenario: The audit needs no PostgreSQL
- **WHEN** the audit runs with only the `MARIADB_*` variables set
- **THEN** it reads the refs and writes the verdict file without opening a PostgreSQL connection

#### Scenario: The runner does not run the audit
- **WHEN** the full migration pipeline runs
- **THEN** no runner step calls the audit or any outside service for DOIs

### Requirement: DOI normalization and syntax
`normalizeDoi` SHALL trim the value and then remove any leading run of `doi:` (any case, with optional whitespace after it), `http://`, `https://`, `dx.doi.org/`, `doi.org/` and `^`. It SHALL NOT change case or any other character. A normalized DOI SHALL be *well formed* when it matches `^10\.\d{4,9}/\S+$`.

#### Scenario: Prefixes are removed
- **WHEN** the source DOI is `doi: 10.1017/S0022336000020096`, `https://doi.org/10.1017/S0022336000020096`, `dx.doi.org/10.1017/S0022336000020096` or `^10.1017/S0022336000020096`
- **THEN** the normalized DOI is `10.1017/S0022336000020096`

#### Scenario: Case is kept
- **WHEN** the source DOI is `DOI:10.1666/0022-3360(2001)075<0001:ANSOTE>2.0.CO;2`
- **THEN** the normalized DOI is `10.1666/0022-3360(2001)075<0001:ANSOTE>2.0.CO;2` and it is well formed

#### Scenario: A short prefix is malformed
- **WHEN** the source DOI is `10.666/12-075`
- **THEN** it is not well formed

#### Scenario: Non-DOI strings are malformed
- **WHEN** the source DOI is `http://hdl.handle.net/2246/1234`, `17 December 1871`, `-` or `10.1016/ j.palaeo.2010.01.001`
- **THEN** it is not well formed

### Requirement: Resolving a DOI
The audit SHALL resolve each distinct well-formed normalized DOI once per run, however many refs share it:
1. It SHALL request `https://api.crossref.org/works/{doi}`. A 200 response gives the metadata, with source `crossref`.
2. On a 404, it SHALL request `https://doi.org/api/handles/{doi}`. A `responseCode` of 100 means the DOI is not registered, with source `none`.
3. If the handle exists, it SHALL request `https://doi.org/{doi}` with `Accept: application/vnd.citationstyles.csl+json`. A CSL-JSON response gives the metadata, with source `doi.org`. Any other response means the DOI is registered without metadata, with source `handle`.

The DOI SHALL be URL-encoded with `encodeURIComponent` in each URL. The metadata is the registered title (with any subtitle appended), the container title, the year issued (else the year published), and the first author's family name (else their name).

#### Scenario: A Crossref DOI
- **WHEN** Crossref returns 200 for a DOI
- **THEN** no doi.org request is made for it, and its source is `crossref`

#### Scenario: A DataCite DOI
- **WHEN** Crossref returns 404 and the handle exists, and doi.org returns CSL JSON
- **THEN** the metadata comes from the CSL JSON, and the source is `doi.org`

#### Scenario: A DOI that does not exist
- **WHEN** Crossref returns 404 and the handle API returns `responseCode` 100
- **THEN** the DOI is not registered, and its source is `none`

#### Scenario: A shared DOI is fetched once
- **WHEN** fourteen refs carry the same DOI
- **THEN** the audit requests it once and scores each of the fourteen refs against the same metadata

### Requirement: Etiquette toward Crossref and doi.org
Every request SHALL send `User-Agent: pbdb2-doi-audit/1.0` and SHALL NOT include an email address, `mailto` parameter, or other personal or project contact details. Requests SHALL be sequential, at most 4 per second overall. On a 429 or 503 the audit SHALL wait for `Retry-After` when given, and otherwise back off exponentially from 2 seconds. On a network error or another 5xx it SHALL retry up to 5 times with backoff. A DOI whose retries run out SHALL get no row in this run and SHALL be counted as `failed`; it SHALL NOT be given a verdict.

#### Scenario: Throttled by Crossref
- **WHEN** Crossref answers 429 with `Retry-After: 10`
- **THEN** the audit waits 10 seconds and repeats the request

#### Scenario: A transient failure is not a verdict
- **WHEN** a DOI's requests fail with network errors through every retry
- **THEN** its refs have no row in the verdict file, the run counts them as `failed`, and the next incremental run audits them again

#### Scenario: No contact details are sent
- **WHEN** any request is made
- **THEN** its headers and URL contain no email address

### Requirement: Title scoring
`tokens(s)` SHALL decode the entities `&lt;`, `&gt;`, `&amp;`, `&quot;`, `&apos;` and `&#N;`, remove `<scp>`, `<sub>` and `<sup>` tags (opening and closing) without a break, replace any other tag with a space, NFKD-decompose, drop combining marks, lowercase, split on non-letters, and keep the distinct words of 3 or more letters that are not in the stopword list. The stopword list holds common English, French, German, Spanish, Italian and Portuguese function words ("the", "and", "from", "des", "der", "und", "del", "los" and the like), and is a constant in `dois.js`. `score(a, b)` SHALL be `|A ∩ B| / min(|A|, |B|)` over the two token sets, and 0 when either set is empty. The thresholds SHALL be constants exported from `dois.js`: the agreement threshold 0.6, the uncertain floor 0.3, and the year tolerance 1.

#### Scenario: Accents, case and markup are ignored
- **WHEN** `a` is `Paléontologie française` and `b` is `<i>Paleontologie</i> Française`
- **THEN** `score(a, b)` is 1

#### Scenario: Short words are ignored
- **WHEN** `a` is `On a new fish` and `b` is `A new fish of Ohio`
- **THEN** the token sets are {new, fish} and {new, fish, ohio}, and `score(a, b)` is 1

#### Scenario: Small caps do not split a word
- **WHEN** `b` is `A new ammonoid fauna from the <scp>C</scp>arnian`
- **THEN** its tokens are {new, ammonoid, fauna, carnian}

#### Scenario: A journal name shares only a function word
- **WHEN** `a` is a crinoid title containing "the" and `b` is `The Lancet`
- **THEN** `score(a, b)` is 0

#### Scenario: Nothing to compare
- **WHEN** either title is blank or has no word of 3 or more letters
- **THEN** `score` is 0

### Requirement: Verdict rules
The audit SHALL give each ref with a non-blank DOI the verdict of the first rule below that applies. `refTitle` is the ref's `reftitle` when non-blank, else its `pubtitle`. T = `score(refTitle, registered title)`. C is the higher of `score(pubtitle, registered title)` (only when `reftitle` is non-blank) and `score(reftitle, registered container title)`. The years agree when either is missing or they differ by no more than the year tolerance. The ref's year is the first run of four digits in `pubyr`. The authors agree when `authorsAgree(author1last, registered first author)` holds. That function compares surnames with accents, case and non-letters removed, and accepts equal names, names one edit apart, and, when both have 4 or more letters, one name that is a prefix of the other.

| # | Condition | Verdict |
|---|---|---|
| 1 | the normalized DOI is not well formed | `malformed` |
| 2 | the DOI is not registered | `unresolvable` |
| 3 | the DOI has no metadata, the ref has no title, or the registered title is blank | `uncertain` |
| 4 | T ≥ 0.6 and the years agree, or T = 1.00 (to two decimals) and the authors agree | `match` |
| 5 | T ≥ 0.6 | `related-work` |
| 6 | C ≥ 0.6 | `part-or-container` |
| 7 | max(T, C) ≥ 0.3 | `uncertain` |
| 8 | `score(pubtitle, registered container title)` ≥ 0.6, the authors agree, and the years agree | `uncertain` |
| 9 | otherwise | `wrong` |

Rule 6 SHALL NOT compare the ref's `pubtitle` with the registered container title; only rule 8 does, and only together with the author and the year. Author agreement SHALL only move a verdict towards keeping the DOI: it never makes a verdict `wrong` or `related-work`, because a surname-and-year match is how the wrong DOIs were attached.

#### Scenario: A wrong DOI
- **WHEN** a 1866 crinoid paper by Hall carries a DOI whose registered title is from *The Lancet* and shares no word with the ref's titles
- **THEN** its verdict is `wrong`, although the registered first author is Hall and the year is 1866

#### Scenario: Another paper by the same author
- **WHEN** T is 0.75, the authors agree, the ref's year is 2005 and the registered year is 2008
- **THEN** its verdict is `related-work`

#### Scenario: An online-first date
- **WHEN** T is 1.00, the authors agree, the ref's year is 2014 and the registered year is 2012
- **THEN** its verdict is `match`

#### Scenario: A review of the book
- **WHEN** T is 1.00, the ref's author is Szalay, the registered first author is Krishtalka, and the years differ by 2
- **THEN** its verdict is `related-work`

#### Scenario: A translated title in the same journal
- **WHEN** the ref's English title shares no word with the registered Spanish title, and the ref's `pubtitle` agrees with the registered container, the authors agree and the years agree
- **THEN** its verdict is `uncertain`, and the DOI is kept

#### Scenario: The DOI is the chapter's book
- **WHEN** a ref has a chapter `reftitle` and a `pubtitle` that agrees with the registered title, and its `reftitle` does not
- **THEN** its verdict is `part-or-container`

#### Scenario: Another article in the same journal
- **WHEN** a journal article's `pubtitle` equals the registered container title, and its `reftitle` shares no word with the registered title
- **THEN** its verdict is `wrong`, not `part-or-container`

#### Scenario: A partial title agreement
- **WHEN** max(T, C) is 0.4
- **THEN** its verdict is `uncertain`

#### Scenario: A registered DOI without metadata
- **WHEN** the handle exists but doi.org returns no CSL JSON
- **THEN** its verdict is `uncertain` and its source is `handle`

### Requirement: Verdict file format
The verdict file SHALL be UTF-8 CSV with the header

`reference_no,source_doi,doi,verdict,score,source,registered_title,registered_container,registered_year,registered_first_author`

and one row per Classic ref whose trimmed `doi` is non-blank and that has a verdict, sorted by `reference_no` ascending. `source_doi` is the trimmed Classic value. `doi` is the normalized value, blank for `malformed`. `score` is T to two decimals, blank when rules 1–3 decided the verdict. `source` is `crossref`, `doi.org`, `handle` or `none`, blank for `malformed`. The `registered_*` fields are blank when there is no metadata. A field SHALL be quoted, with internal `"` doubled, when it contains `"`, `,` or a newline. The file SHALL contain nothing that varies between runs over the same inputs.

#### Scenario: A non-DOI string with commas
- **WHEN** a ref's DOI is `Smith, J., and Jones, K.`
- **THEN** its row has `source_doi` quoted, `verdict` = `malformed`, and blank `doi`, `score`, `source` and `registered_*` fields

#### Scenario: Rows round-trip
- **WHEN** the file is written and read back with `dois.js`
- **THEN** every field reads back unchanged, including titles with commas, quotes and non-ASCII characters

### Requirement: Incremental, full and rescore runs
By default the audit SHALL be incremental. It SHALL audit a ref that has no row, or whose row's `source_doi` differs from its current trimmed `doi`. It SHALL keep every other row unchanged, and it SHALL remove rows for refs that no longer have a non-blank `doi`. During the run it SHALL rewrite the file atomically, through a temporary file and a rename, at least every 500 resolved DOIs and at the end, so an interrupted run resumes when re-run.

`--all` SHALL re-resolve every ref. `--rescore` SHALL make no network requests. It SHALL recompute `verdict` and `score` for every row that has metadata, from that row's `registered_*` fields and the ref's current fields.

At the end the audit SHALL log the number of rows per verdict, the number `failed`, and the number of HTTP requests made.

#### Scenario: Re-running after an interruption
- **WHEN** a run is stopped after 10,000 DOIs and started again
- **THEN** the second run makes no request for refs that already have a row with the same `source_doi`

#### Scenario: A DOI changed in a new dump
- **WHEN** a ref's Classic `doi` differs from its row's `source_doi`
- **THEN** the incremental run audits it again and replaces the row

#### Scenario: A ref's DOI was removed
- **WHEN** a ref with a row now has a blank `doi`
- **THEN** its row is removed

#### Scenario: Threshold change applied offline
- **WHEN** a threshold constant changes and the audit runs with `--rescore`
- **THEN** verdicts and scores are recomputed without any network request, and rows with no metadata are unchanged

#### Scenario: A hand-edited verdict survives an incremental run
- **WHEN** a curator changes a row's `verdict` and the ref's `doi` is unchanged
- **THEN** an incremental run leaves the row as edited
