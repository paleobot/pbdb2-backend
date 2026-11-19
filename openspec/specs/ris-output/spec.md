# ris-output

## Purpose

RIS output for references, the format reference managers import, selected only
by the `Accept` header: which reads offer it (the references list, `ids` and
single reads), the publication-type → `TY` mapping, the field → tag mapping in a
fixed order (checked against Zotero's importer), text encoding, the single-read
response, and the list behaviour RIS shares with CSV (paging, streaming, errors
and the export cap).

## Requirements
### Requirement: RIS is selected by the Accept header

The system SHALL return RIS from a read that offers it only when the request's `Accept` header names `application/x-research-info-systems` under the rule by which it selects CSV (`csv-output`): a non-zero `q` strictly greater than any `q` explicitly given to `application/json`. In every other case, including an absent `Accept`, a wildcard, or a tie, the response SHALL be JSON. No query parameter or URL suffix SHALL select the format. A RIS response SHALL have `Content-Type: application/x-research-info-systems; charset=utf-8` and `Vary: Accept`.

#### Scenario: A client asks for RIS from the list

- **WHEN** a client sends `GET /api/v1/references` with `Accept: application/x-research-info-systems`
- **THEN** the response has `Content-Type: application/x-research-info-systems; charset=utf-8`
- **AND** the response has `Vary: Accept`
- **AND** the response has `Content-Disposition: attachment; filename="references.ris"`

#### Scenario: A wildcard does not select RIS

- **WHEN** a client sends `GET /api/v1/references` with `Accept: */*`
- **THEN** the response is the JSON envelope

#### Scenario: A tie goes to JSON

- **WHEN** a client sends `Accept: application/x-research-info-systems, application/json`
- **THEN** the response is the JSON envelope

#### Scenario: RIS ranked above CSV

- **WHEN** a client sends `GET /api/v1/references` with `Accept: application/x-research-info-systems, text/csv;q=0.5`
- **THEN** the response is RIS

### Requirement: Only references offer RIS

The list, `ids` and single reads of `references` SHALL offer RIS. No other read SHALL offer it: a `GET` or `HEAD` that selects RIS on any other route SHALL be answered with HTTP 406 in the standard error shape, as `csv-output` provides for a format a route does not offer. The single read of `references` SHALL offer RIS and SHALL NOT offer CSV.

#### Scenario: Authorities do not offer RIS

- **WHEN** a client sends `GET /api/v1/authorities` with `Accept: application/x-research-info-systems`
- **THEN** the system responds with HTTP 406 in the standard error shape

#### Scenario: A collection single read does not offer RIS

- **WHEN** a client sends `GET /api/v1/collections/{permid}` with `Accept: application/x-research-info-systems`
- **THEN** the system responds with HTTP 406 in the standard error shape

#### Scenario: A reference single read still refuses CSV

- **WHEN** a client sends `GET /api/v1/references/{permid}` with `Accept: text/csv`
- **THEN** the system responds with HTTP 406 in the standard error shape

#### Scenario: An ids read offers RIS

- **WHEN** a client sends `GET /api/v1/references?ids=<a>,<b>` with `Accept: application/x-research-info-systems`
- **THEN** the body holds one RIS record per permid found

### Requirement: A reference single read returns one RIS record

A single read of a reference that selects RIS SHALL respond with HTTP 200, the reference's one RIS record as the body, and `Content-Disposition: attachment; filename="<permid>.ris"`. A permid with no current reference SHALL be answered with HTTP 404 in the standard JSON error shape. A `HEAD` SHALL send the same status and headers with no body. An unrecognized query parameter SHALL be a 400, as on every single read.

#### Scenario: A reference exists

- **WHEN** a client sends `GET /api/v1/references/{permid}` with `Accept: application/x-research-info-systems`
- **THEN** the system responds with HTTP 200 and a body holding exactly one record, beginning `TY  - ` and ending `ER  - `
- **AND** the response has `Content-Disposition: attachment; filename="{permid}.ris"`

#### Scenario: No such reference

- **WHEN** a client requests RIS for a permid with no current reference
- **THEN** the system responds with HTTP 404 and a JSON body

#### Scenario: HEAD on a single read

- **WHEN** a client sends `HEAD /api/v1/references/{permid}` with `Accept: application/x-research-info-systems`
- **THEN** the response has status 200, the RIS content type and no body

### Requirement: Publication type maps to a RIS type

Each record's `TY` SHALL be determined by its `publicationType`:

| publicationType | `TY` |
|---|---|
| journal article | `JOUR` |
| article in edited collection | `CHAP` |
| edited collection | `EDBOOK` |
| serial monograph | `SER` |
| standalone book with `bookType` `Ph.D. thesis` or `M.S. thesis` | `THES` |
| standalone book with any other or no `bookType` | `BOOK` |
| unpublished | `UNPD` |
| other | `GEN` |

#### Scenario: A chapter

- **WHEN** an `article in edited collection` is exported
- **THEN** its first line is `TY  - CHAP`

#### Scenario: A thesis

- **WHEN** a `standalone book` with `bookType` `Ph.D. thesis` is exported
- **THEN** its first line is `TY  - THES`
- **AND** it has `M3  - Ph.D. thesis`

#### Scenario: A monograph

- **WHEN** a `standalone book` with `bookType` `monograph` is exported
- **THEN** its first line is `TY  - BOOK`
- **AND** it has no `M3` line

#### Scenario: A serial monograph

- **WHEN** a `serial monograph` is exported
- **THEN** its first line is `TY  - SER`

#### Scenario: Unpublished

- **WHEN** an `unpublished` reference is exported
- **THEN** its first line is `TY  - UNPD`

### Requirement: Fields map to tags in a fixed order

A record SHALL consist of the following tags, in this order. A tag whose value is absent, null or blank SHALL be omitted, except `TY`, `ID`, `UR`, `DB` and `ER`, which every record has.

| Tag | Value |
|---|---|
| `TY` | the RIS type |
| `ID` | `permid` |
| `UR` | the reference's absolute API URL: the public base URL, `/api/v1/references/`, then `permid` |
| `DB` | `Paleobiology Database` |
| `AU` | one line per author |
| `A2` or `A3` | `editors` |
| `PY` | `publicationYear`, as stored |
| `TI` | `title` |
| `T2` | `journalTitle`, else `bookTitle`, else `seriesTitle` |
| `M3` | `bookType`, on `THES` only |
| `VL` | `journalVolume`, else `seriesVolume` |
| `IS` or `M1` | `journalNumber`, else `seriesNumber`: `M1` when `TY` is `SER`, `EDBOOK`, `BOOK` or `THES`, `IS` otherwise |
| `SP` | `pages.first`; on `SER`, `EDBOOK`, `BOOK`, `THES` and `UNPD`, the pages as one value (below) |
| `EP` | `pages.last`, only when it differs from `pages.first`; never on `SER`, `EDBOOK`, `BOOK`, `THES` or `UNPD` |
| `PB` | `publisher` |
| `CY` | `publicationCity` |
| `N1` | `comments` |
| `N1` | `description`, on a line of its own after `comments` |
| `LA` | `language` |
| `DO` | `doi`, as stored |
| `ER` | empty |

The same precedence for `T2`, `VL` and the number SHALL apply to every publication type. No other field SHALL be exported; in particular `legacyIDs` SHALL NOT be.

On `SER`, `EDBOOK`, `BOOK`, `THES` and `UNPD`, where Zotero reads `SP` as the number of pages and drops `EP`, the pages SHALL be one `SP` value: `pages.last` when `pages.first` is 1 (a page count); the one page when only one is present or both are equal; otherwise `pages.first`, a hyphen and `pages.last`.

#### Scenario: A journal article

- **WHEN** a journal article with `journalTitle` `Journal of Paleontology`, `journalVolume` `72`, `journalNumber` `3`, pages 401–420 and a `doi` is exported
- **THEN** the record has `T2  - Journal of Paleontology`, `VL  - 72`, `IS  - 3`, `SP  - 401`, `EP  - 420` and `DO  - ` with the DOI, in that order

#### Scenario: A serial monograph's series

- **WHEN** a serial monograph with `seriesTitle` `Bulletin of the New Mexico Museum of Natural History and Science`, `seriesVolume` `62` and `seriesNumber` `2` is exported
- **THEN** the record has `T2` with the series title, `VL  - 62` and `M1  - 2`
- **AND** it has no `IS` line

#### Scenario: A chapter's book

- **WHEN** an `article in edited collection` with `bookTitle` `Dinosaur Tracks` is exported
- **THEN** the record has `T2  - Dinosaur Tracks`

#### Scenario: A book's pages from page 1

- **WHEN** a `standalone book` with `pages.first` 1 and `pages.last` 94 is exported
- **THEN** the record has `SP  - 94` and no `EP` line

#### Scenario: A range inside a series volume

- **WHEN** a `serial monograph` with `pages.first` 834 and `pages.last` 848 is exported
- **THEN** the record has `SP  - 834-848` and no `EP` line

#### Scenario: A single page

- **WHEN** a reference with `pages.first` 12 and `pages.last` 12 is exported
- **THEN** the record has `SP  - 12` and no `EP` line

#### Scenario: Comments and description

- **WHEN** an unpublished reference with `comments` and a `description` is exported
- **THEN** the record has two `N1` lines, the comments first

#### Scenario: A reference with no title

- **WHEN** a migrated reference with no `title` is exported
- **THEN** the record has no `TI` line and is otherwise complete

#### Scenario: The link back

- **WHEN** reference `REF-0000001-12` is exported
- **THEN** the record has `ID  - REF-0000001-12` and `UR  - <public base URL>/api/v1/references/REF-0000001-12`

### Requirement: Authors are written family name first

Each element of `authors` SHALL be one `AU` line, in array order: `familyName, givenName`, or `familyName` alone when `givenName` is absent or blank. An author with a blank `familyName` and a non-blank `givenName` SHALL be written as `givenName` alone. An author with neither SHALL be skipped.

#### Scenario: Two authors

- **WHEN** a reference has authors `{familyName: "Bone", givenName: "D. A."}` and `{familyName: "Smith"}`
- **THEN** the record has `AU  - Bone, D. A.` followed by `AU  - Smith`

### Requirement: Editors are one line, tagged by type

`editors` SHALL be written unparsed, as one line. Its tag SHALL be `A3` when `TY` is `SER`, `EDBOOK`, `BOOK` or `THES`, and `A2` when `TY` is `CHAP`, `JOUR`, `GEN` or `UNPD`.

#### Scenario: A chapter's editors

- **WHEN** an `article in edited collection` with `editors` `P. L. Falkingham, D. Marty, & A. Richter` is exported
- **THEN** the record has `A2  - P. L. Falkingham, D. Marty, & A. Richter`

#### Scenario: An edited volume's editors

- **WHEN** a `serial monograph` with `editors` is exported
- **THEN** the editors are on an `A3` line

### Requirement: RIS text encoding

RIS output SHALL be UTF-8 with no byte order mark. Every line SHALL be the tag, two spaces, a hyphen, a space and the value, and SHALL end with CRLF. A record SHALL end with `ER  - ` (with its trailing space), and records SHALL be separated by one blank line. Within a value, every run of whitespace that contains a CR or LF SHALL become one space, and the value SHALL be trimmed. Values SHALL NOT be truncated. No line SHALL precede the first record.

#### Scenario: A multi-line comment

- **WHEN** a reference's `comments` is `First line.\r\n  Second line.`
- **THEN** the record has the one line `N1  - First line. Second line.`

#### Scenario: Two records

- **WHEN** two references are exported
- **THEN** the body is the first record, ending `ER  - ` and CRLF, then an empty line ending CRLF, then the second record

#### Scenario: Non-ASCII text

- **WHEN** an author's family name is `Jiménez-Hidalgo`
- **THEN** it is written in UTF-8, unescaped

### Requirement: RIS lists behave as CSV lists do

A RIS list read SHALL follow the `csv-output` rules for a non-JSON list: with no `limit` and no `ids` it returns every matching record, in `permid_no` order, streamed; with `limit` it returns one page with `Link` headers for further pages; an `ids` read sends no `Link` header; errors before the response starts are JSON; an unbounded RIS export takes one of the `MAX_CONCURRENT_EXPORTS` slots shared with CSV; and a `HEAD` reads at most the first batch and takes no slot. A list with no matching records SHALL respond with HTTP 200 and an empty body.

#### Scenario: The whole result

- **WHEN** a client requests the references list as RIS with no `limit` and more records match than the maximum page size
- **THEN** the body holds one record for every matching reference, exactly once, in `permid_no` order

#### Scenario: A page

- **WHEN** a client requests the references list as RIS with `limit=10` and more records match
- **THEN** the body holds 10 records
- **AND** the `Link` header has a `rel="next"` URL carrying the same `limit` and filters

#### Scenario: The export cap is shared with CSV

- **WHEN** the maximum number of unbounded CSV exports are running and an unbounded RIS export is requested
- **THEN** the system responds with HTTP 503, a JSON body and `Retry-After`

#### Scenario: No matches

- **WHEN** a RIS list matches no records
- **THEN** the system responds with HTTP 200 and an empty body

#### Scenario: An invalid filter

- **WHEN** a client sends an invalid query parameter with `Accept: application/x-research-info-systems`
- **THEN** the system responds with HTTP 400 and a JSON body
