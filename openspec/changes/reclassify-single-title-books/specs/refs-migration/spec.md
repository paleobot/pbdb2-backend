## MODIFIED Requirements

### Requirement: Publication type mapping
The script SHALL map legacy `publication_type` values to the jsonb `publicationType` string using the following mapping. It SHALL NOT write a `reference_type_id` column, which no longer exists: the reference source's inline `publicationType` enum is the only vocabulary for publication types.

| Legacy value | jsonb publicationType | jsonb bookType |
|---|---|---|
| "journal article" | "journal article" | — |
| "serial monograph" | "serial monograph" | — |
| "unpublished" | "unpublished" | — |
| "book/book chapter" | "standalone book" ("monograph"), or "article in edited collection" by its titles (below) | "monograph" when "standalone book" |
| "book chapter" | "article in edited collection" | — |
| "book" | "standalone book" ("monograph"), or "article in edited collection" by its titles and editors (below) | "monograph" when "standalone book" |
| "compendium" | "standalone book" | "compendium" |
| "Ph.D. thesis" | "standalone book" | "Ph.D. thesis" |
| "M.S. thesis" | "standalone book" | "M.S. thesis" |
| "guidebook" | "standalone book" | "guidebook" |
| "news article" | "other" | — |
| "abstract" | "other" | — |
| NULL | "other" | — |
| any other | "other" | — |

A ref *has two titles* when its `reftitle` and `pubtitle`, each trimmed, are both non-blank and are not equal ignoring case. (Ref 54259 has the same book title in both fields, differing only in capitalisation.) A ref *has editors* when the script's editor assembly (see Editor handling) yields a value for it.

- A "book/book chapter" ref that has two titles SHALL map to "article in edited collection". Every other "book/book chapter" ref SHALL map to "standalone book" with `bookType` "monograph", whether or not it has editors: in Classic, one title is how a whole book was stored, and almost all such refs are authored books.
- A "book" ref that has two titles and has editors SHALL map to "article in edited collection", with no `bookType`. Every other "book" ref SHALL map to "standalone book" with `bookType` "monograph".

No legacy value SHALL map to "edited collection". That type remains in the reference source's enum for PBot refs and for references created through the API.

The mapping SHALL be a table in the script, with these two title rules beside it; neither SHALL be read from `dictionaries`.

#### Scenario: Direct mapping
- **WHEN** a ref has `publication_type = 'journal article'`
- **THEN** jsonb `publicationType` = "journal article", and the row written has no `reference_type_id` column

#### Scenario: Standalone book with bookType
- **WHEN** a ref has `publication_type = 'Ph.D. thesis'`
- **THEN** jsonb `publicationType` = "standalone book" and jsonb `bookType` = "Ph.D. thesis"

#### Scenario: NULL publication type
- **WHEN** a ref has `publication_type = NULL`
- **THEN** jsonb `publicationType` = "other"

#### Scenario: Unmapped legacy value
- **WHEN** a ref has a `publication_type` not listed in the mapping table
- **THEN** jsonb `publicationType` = "other" and the script logs a warning with the `reference_no` and original value

#### Scenario: Book/book chapter with two titles is a chapter
- **WHEN** a ref has `publication_type = 'book/book chapter'`, `reftitle = 'Silurian brachiopod communities of Tuva'` and `pubtitle = 'Paleocommunities--a case study from the Silurian and Lower Devonian'`
- **THEN** jsonb `publicationType` = "article in edited collection"

#### Scenario: Book/book chapter with only a pubtitle is a standalone book
- **WHEN** a ref has `publication_type = 'book/book chapter'`, a blank `reftitle` and `pubtitle = 'Die vorzeitlichen Saugetiere'`
- **THEN** jsonb `publicationType` = "standalone book" and jsonb `bookType` = "monograph"

#### Scenario: Equal titles are a standalone book
- **WHEN** a ref has `publication_type = 'book/book chapter'` and `reftitle` and `pubtitle` that are equal after trimming and ignoring case
- **THEN** jsonb `publicationType` = "standalone book" and jsonb `bookType` = "monograph"

#### Scenario: Book/book chapter with one title and editors is a standalone book
- **WHEN** a ref has `publication_type = 'book/book chapter'`, a blank `reftitle`, a non-blank `pubtitle` and `editors = 'Martin and Barnosky'`
- **THEN** jsonb `publicationType` = "standalone book", jsonb `bookType` = "monograph", and jsonb `editors` = "Martin and Barnosky"

#### Scenario: Book/book chapter with neither title is a standalone book
- **WHEN** a ref has `publication_type = 'book/book chapter'` and a blank `reftitle` and `pubtitle`
- **THEN** jsonb `publicationType` = "standalone book" and jsonb `bookType` = "monograph"

#### Scenario: Book with two titles and editors is a chapter
- **WHEN** a ref has `publication_type = 'book'`, `reftitle = 'Chapter 7 - Devonian'`, `pubtitle = 'The Geology of Pennsylvania'` and `editors = 'C. H. Schultz'`
- **THEN** jsonb `publicationType` = "article in edited collection" and the jsonb has no `bookType`

#### Scenario: Book with two titles and no editors stays a standalone book
- **WHEN** a ref has `publication_type = 'book'`, two titles, and no editors in `editors` or `ref_editors`
- **THEN** jsonb `publicationType` = "standalone book" and jsonb `bookType` = "monograph"

#### Scenario: Title-rule counts
- **WHEN** the migration completes against `pbdb_2026_10_18`
- **THEN** 3,045 "book/book chapter" refs and 78 "book" refs map to "article in edited collection" by the title rules, 665 "book/book chapter" refs without two titles map to "standalone book", 236 "book" refs with two titles and no editors map to "standalone book", and no PBDB ref maps to "edited collection"

### Requirement: Title mapping
The script SHALL map `reftitle` to the jsonb `title` field. A `reftitle` that is NULL or blank after trimming
SHALL be treated as absent.

When `reftitle` is absent and the ref maps to "standalone book", the script SHALL use the legacy `pubtitle`,
trimmed, as `title` if it is non-blank. Legacy PBDB records a whole book with `reftitle` empty and the book's
title in `pubtitle`; without this fallback the title is discarded, because `pubtitle` has no other
destination for that type. The value SHALL be taken verbatim, including the few that begin `in ` and name a
containing volume rather than the ref, and each fallback SHALL be logged with the `reference_no`.

For every other type, an absent `reftitle` leaves `title` omitted: their `pubtitle` is routed to its own
field, or names a container the type has no field for.

#### Scenario: Standard title
- **WHEN** a ref has `reftitle = 'On the origin of species'`
- **THEN** the jsonb `title` = "On the origin of species"

#### Scenario: NULL title
- **WHEN** a ref maps to "journal article" and has `reftitle = NULL`
- **THEN** the jsonb `title` is omitted and the script logs a warning

#### Scenario: Book title recovered from pubtitle
- **WHEN** a ref maps to "standalone book", has `reftitle = ''` and `pubtitle = 'Systema Naturae'`
- **THEN** the jsonb `title` = "Systema Naturae" and the script logs the `reference_no` as a pubtitle fallback

#### Scenario: Single-title book/book chapter title recovered from pubtitle
- **WHEN** a "book/book chapter" ref has `reftitle = NULL` and `pubtitle = 'Acadian Geology'`
- **THEN** it maps to "standalone book" and the jsonb `title` = "Acadian Geology"

#### Scenario: Reftitle wins when present
- **WHEN** a ref maps to "standalone book" and has both `reftitle = 'Mazon Creek Fossils'` and a non-blank `pubtitle`
- **THEN** the jsonb `title` = "Mazon Creek Fossils" and no fallback is logged

#### Scenario: Other types do not fall back
- **WHEN** a ref maps to "other", has `reftitle = ''` and `pubtitle = 'Geological Society of America Abstracts with Programs'`
- **THEN** the jsonb `title` is omitted

#### Scenario: Restored count
- **WHEN** the migration completes against the full legacy source
- **THEN** 1,468 refs have a `title` taken from `pubtitle`, and 541 of the refs it wrote have no `title`

### Requirement: Publication title routing
The script SHALL map the legacy `pubtitle` column to a type-specific jsonb field:

| Target publicationType | jsonb field |
|---|---|
| journal article | `journalTitle` |
| serial monograph | `seriesTitle` |
| article in edited collection | `bookTitle` |
| standalone book | `title`, only when `reftitle` is absent (see Title mapping); for a "book" ref with two titles, the container note (see Container note for books with two titles); otherwise not mapped |
| unpublished | (not mapped) |
| other | (not mapped) |

No PBDB ref maps to "edited collection" (see Publication type mapping), so that type has no row.

A ref that maps to "article in edited collection" by a title rule routes its `pubtitle` to `bookTitle` like any other.

#### Scenario: Journal article pubtitle
- **WHEN** a ref maps to "journal article" and has `pubtitle = 'Nature'`
- **THEN** the jsonb contains `journalTitle: "Nature"`

#### Scenario: Article in edited collection pubtitle
- **WHEN** a ref maps to "article in edited collection" and has `pubtitle = 'Fossil Record'`
- **THEN** the jsonb contains `bookTitle: "Fossil Record"`

#### Scenario: A reclassified chapter keeps its book title
- **WHEN** a "book/book chapter" ref with `reftitle = 'A new toothed bird from China'` and `pubtitle = 'Feathered Dinosaurs and the Origin of Flight'` is migrated
- **THEN** the jsonb contains `title: "A new toothed bird from China"` and `bookTitle: "Feathered Dinosaurs and the Origin of Flight"`

#### Scenario: Book pubtitle alongside a reftitle
- **WHEN** a ref maps to "standalone book", has a non-blank `reftitle`, and its `pubtitle` is blank or equal to the `reftitle`
- **THEN** its `pubtitle` is not written to any jsonb field

### Requirement: Migration logging
The script SHALL log:
- Start and completion messages with timestamps
- Source row counts (refs, ref_authors, ref_editors)
- Number of rows upserted
- Publication type mapping summary (count per target type)
- Number of titles taken from `pubtitle`, and each such `reference_no`
- Number of refs mapped to "article in edited collection" by each title rule ("book/book chapter", "book")
- Number of "book/book chapter" refs mapped to "standalone book" because they lack two titles
- Number of container notes written
- Number of rows written to the single-title books review list, and the number of rows carrying each signal
- Warnings for: NULL publication types, non-numeric pages, unparseable otherauthors, missing authors, zero person IDs
- Elapsed time

#### Scenario: Successful migration log output
- **WHEN** the migration completes without errors
- **THEN** the console output includes start time, source counts, upsert count, pub type summary, the pubtitle fallback count, the count for each title rule, the count of single-title "book/book chapter" refs mapped to "standalone book", the container note count, the review-list row count with a count per signal, any warnings, and elapsed time

## ADDED Requirements

### Requirement: Review list of suspect single-title books
On every run, after the upsert, the script SHALL write a review list of the "book/book chapter" refs it mapped to "standalone book" because they lack two titles, when a ref matches at least one of the signals below. The list is a reading aid for curators: the signals are unverified, each flags many authored books, and the script SHALL NOT change any ref's mapping because of them.

The list SHALL be written to `src/refs-migration/single-title-books-review.csv`, beside the script, and is a version-controlled file: it SHALL NOT be gitignored. It SHALL be UTF-8 CSV with the header

`reference_no,permid,authors,editors,year,title,pages,signals`

and one row per listed ref, sorted by `reference_no` ascending:

| Column | Value |
|---|---|
| `reference_no` | the Classic `reference_no` |
| `permid` | the ref's permid |
| `authors` | the migrated authors' family names in order, joined by `; ` |
| `editors` | the migrated `editors`, blank when absent |
| `year` | the migrated `publicationYear`, blank when absent |
| `title` | the migrated `title`, blank when absent |
| `pages` | `first–last` from the migrated `pages`; otherwise the raw `firstpage` and `lastpage` joined by `–`; blank when both are blank |
| `signals` | the name of every matching signal, in the order of the table below, joined by `; ` |

A field SHALL be quoted, with internal `"` doubled, when it contains `"`, `,` or a newline. The file SHALL contain nothing that varies between runs over the same source data (no timestamp or run identifier), so that an unchanged source rewrites it byte for byte.

Signals, in order. "Title" is the migrated `title`. Titles in the two lookup sets and the ref's `pubtitle` are compared trimmed and lowercased:

| Signal | Matches when |
|---|---|
| `chapter-missing-title` | the ref has editors, and its title is absent or begins with `in ` or `in:`, ignoring case |
| `multi-author-no-editors` | the ref has two or more migrated authors and no editors |
| `pubtitle-is-book-title` | the ref's `pubtitle` equals the `bookTitle` of at least one ref this run mapped to "article in edited collection" |
| `pubtitle-is-journal-title` | the ref's `pubtitle` equals the `journalTitle` of at least one ref this run mapped to "journal article" |
| `first-page-after-1` | the ref's `firstpage` is numeric and greater than 1 |
| `edited-volume-words` | the title contains "proceedings", "symposium", "congress", "conference", "festschrift" or "in honour"/"in honor"; or the title or `comments` contains the word "ed.", "eds.", "editor", "editors" or "edited"; all ignoring case |

#### Scenario: A chapter missing its title is listed
- **WHEN** a "book/book chapter" ref has a blank `reftitle` and `pubtitle`, `editors = 'Biggs'` and two authors
- **THEN** the review list has a row for it whose `signals` = "chapter-missing-title" and whose `title` is blank

#### Scenario: A co-authored book is listed with its signal
- **WHEN** a "book/book chapter" ref has only `pubtitle = 'In the Shadow of the Dinosaurs; Early Mesozoic Tetrapods'`, authors Fraser and Sues, and no editors
- **THEN** the review list has a row for it with `authors` = "Fraser; Sues" and `signals` containing "multi-author-no-editors", and the ref is still migrated as "standalone book"

#### Scenario: Several signals on one ref
- **WHEN** a listed ref has two authors, no editors, a `pubtitle` that another ref uses as its `bookTitle`, and no other signal
- **THEN** its `signals` = "multi-author-no-editors; pubtitle-is-book-title"

#### Scenario: A plain authored book is not listed
- **WHEN** a "book/book chapter" ref has only a `pubtitle` that no other ref uses as a book or journal title, one author, no editors, `firstpage = '1'`, and no edited-volume words
- **THEN** the review list has no row for it

#### Scenario: Refs outside the reclassification are never listed
- **WHEN** a ref maps to "article in edited collection" by a title rule, or comes from any Classic type other than "book/book chapter"
- **THEN** the review list has no row for it, whatever signals it would match

#### Scenario: Unchanged source rewrites an identical file
- **WHEN** the migration is run twice over the same source data
- **THEN** the second run's `single-title-books-review.csv` is byte-identical to the first

#### Scenario: Titles with commas and non-ASCII characters
- **WHEN** a listed ref's title is `Paléontologie française: Terrains crétacés, 1`
- **THEN** its `title` field is written quoted, in UTF-8, and reads back unchanged
