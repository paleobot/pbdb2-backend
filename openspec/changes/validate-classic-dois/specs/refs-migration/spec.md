## ADDED Requirements

### Requirement: DOIs are normalized and filtered by the audit's verdicts
At startup, before reading refs, the script SHALL read `src/refs-migration/inputs/doi-verdicts.csv` (see `classic-doi-audit`), resolved relative to the script. If the file is missing or cannot be parsed, the migration SHALL abort. The script SHALL make no network requests.

For each ref whose trimmed `doi` is non-blank, the script SHALL look up the row with its `reference_no`. A row is *current* when its `source_doi` equals the ref's trimmed `doi`.

| Case | jsonb `doi` |
|---|---|
| current row with verdict `match`, `part-or-container` or `uncertain` | the normalized DOI |
| current row with verdict `wrong`, `related-work`, `unresolvable` or `malformed` | omitted |
| no row, or a row that is not current, and the normalized DOI is well formed | the normalized DOI (*unaudited*) |
| no row, or a row that is not current, and the normalized DOI is not well formed | omitted (*unaudited-malformed*) |

The stored value SHALL be computed by `normalizeDoi` from `src/refs-migration/dois.js`, not copied from the file's `doi` column. When any ref is unaudited or unaudited-malformed, the script SHALL log a warning with both counts and the first 20 such `reference_no`s.

#### Scenario: A prefixed DOI is stored normalized
- **WHEN** a ref has `doi = 'doi:10.1017/S0022336000020096'` and a current row with verdict `match`
- **THEN** the jsonb contains `doi: "10.1017/S0022336000020096"`

#### Scenario: A wrong DOI is dropped
- **WHEN** a ref has a current row with verdict `wrong`
- **THEN** the jsonb has no `doi`, and every other field is migrated as before

#### Scenario: A non-DOI string is dropped
- **WHEN** a ref has `doi = 'http://www.jstor.org/stable/1302950'` and a current row with verdict `malformed`
- **THEN** the jsonb has no `doi`

#### Scenario: An uncertain DOI is kept
- **WHEN** a ref has a current row with verdict `uncertain`
- **THEN** the jsonb contains the normalized DOI

#### Scenario: A ref with no row
- **WHEN** a ref has `doi = '10.1234/new.2026'` and no row in the verdict file
- **THEN** the jsonb contains `doi: "10.1234/new.2026"`, the ref is counted as unaudited, and the run logs a warning naming its `reference_no`

#### Scenario: A stale row
- **WHEN** a ref's row has verdict `wrong` and `source_doi = '10.1111/old'`, and the ref's `doi` is now `10.1111/new`
- **THEN** the row is not current, the jsonb contains `doi: "10.1111/new"`, and the ref is counted as unaudited

#### Scenario: An unaudited malformed DOI
- **WHEN** a ref has `doi = '-'` and no row
- **THEN** the jsonb has no `doi`, and the ref is counted as unaudited-malformed

#### Scenario: The verdict file is missing
- **WHEN** `inputs/doi-verdicts.csv` does not exist
- **THEN** the migration aborts before writing any row

## MODIFIED Requirements

### Requirement: Additional jsonb fields
The script SHALL populate:
- `doi` as the normalized DOI, omitted when the source `doi` is blank or the DOI is dropped (see DOIs are normalized and filtered by the audit's verdicts)
- `legacyIDs` as an object containing `oldpbdbID` from the source `reference_no` (as a string) for traceability
- `publicationYear` from the source `pubyr`
- `publisher` from the source `publisher` (for applicable publication types)
- `publicationCity` from the source `pubcity` (for applicable publication types)
- `comments` from the source `comments` column, followed by the container note where one applies (see Container note); omitted if both are absent

#### Scenario: DOI present
- **WHEN** a ref has `doi = '10.1234/example'` and a current verdict row with verdict `match`
- **THEN** the jsonb contains `doi: "10.1234/example"`

#### Scenario: DOI blank
- **WHEN** a ref has `doi = NULL` or `doi = '  '`
- **THEN** the `doi` field is omitted from the jsonb

#### Scenario: oldpbdbID nested under legacyIDs
- **WHEN** a ref with `reference_no = 5000` is migrated
- **THEN** the jsonb contains `legacyIDs: { oldpbdbID: "5000" }`

#### Scenario: Comments present
- **WHEN** a ref has `comments = 'See also ref 1234'` and no container note applies
- **THEN** the jsonb contains `comments: "See also ref 1234"`

#### Scenario: Comments NULL or empty
- **WHEN** a ref has `comments = NULL` or `comments = ''` and no container note applies
- **THEN** the `comments` field is omitted from the jsonb

### Requirement: Migration logging
The script SHALL log:
- Start and completion messages with timestamps
- Source row counts (refs, ref_authors, ref_editors)
- The number of rows read from the DOI verdict file
- Number of rows upserted
- Publication type mapping summary (count per target type)
- Number of titles taken from `pubtitle`, and each such `reference_no`
- Number of refs mapped to "article in edited collection" by each title rule ("book/book chapter", "book")
- Number of "book/book chapter" refs mapped to "standalone book" because they lack two titles
- Number of container notes written, split into "book" refs with two titles and no editors, and refs that map to "article in edited collection"
- Number of rows written to the single-title books review list, split by Classic type ("book/book chapter", "book"), and the number of rows carrying each signal
- DOI summary: the number of DOIs normalized (a prefix was removed), the number kept for each kept verdict and for unaudited, and the number dropped for each dropped verdict and for unaudited-malformed
- Warnings for: NULL publication types, non-numeric pages, unparseable otherauthors, missing authors, zero person IDs, unaudited DOIs
- Elapsed time

#### Scenario: Successful migration log output
- **WHEN** the migration completes without errors
- **THEN** the console output includes start time, source counts, the verdict-file row count, upsert count, pub type summary, the pubtitle fallback count, the count for each title rule, the count of single-title "book/book chapter" refs mapped to "standalone book", the container note counts for books and for chapters, the review-list row count by Classic type with a count per signal, the DOI summary, any warnings, and elapsed time

#### Scenario: DOI summary adds up
- **WHEN** the migration completes
- **THEN** the DOI summary's kept and dropped counts sum to the number of refs with a non-blank `doi`
