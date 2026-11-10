## MODIFIED Requirements

### Requirement: Publication type mapping
The script SHALL map legacy `publication_type` values to the jsonb `publicationType` string using the following mapping. It SHALL NOT write a `reference_type_id` column, which no longer exists: the reference source's inline `publicationType` enum is the only vocabulary for publication types.

| Legacy value | jsonb publicationType | jsonb bookType |
|---|---|---|
| "journal article" | "journal article" | — |
| "serial monograph" | "serial monograph" | — |
| "unpublished" | "unpublished" | — |
| "book/book chapter" | "edited collection", or "article in edited collection" by its titles (below) | — |
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

A ref *has two titles* when its `reftitle` and `pubtitle`, each trimmed, are both non-blank and are not equal. A ref *has editors* when the script's editor assembly (see Editor handling) yields a value for it.

- A "book/book chapter" ref that has two titles SHALL map to "article in edited collection". Every other "book/book chapter" ref SHALL map to "edited collection".
- A "book" ref that has two titles and has editors SHALL map to "article in edited collection", with no `bookType`. Every other "book" ref SHALL map to "standalone book" with `bookType` "monograph".

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

#### Scenario: Book/book chapter with only a pubtitle stays an edited collection
- **WHEN** a ref has `publication_type = 'book/book chapter'`, a blank `reftitle` and `pubtitle = 'Corals of the World'`
- **THEN** jsonb `publicationType` = "edited collection"

#### Scenario: Equal titles stay an edited collection
- **WHEN** a ref has `publication_type = 'book/book chapter'` and `reftitle` and `pubtitle` that are equal after trimming
- **THEN** jsonb `publicationType` = "edited collection"

#### Scenario: Book with two titles and editors is a chapter
- **WHEN** a ref has `publication_type = 'book'`, `reftitle = 'Chapter 7 - Devonian'`, `pubtitle = 'The Geology of Pennsylvania'` and `editors = 'C. H. Schultz'`
- **THEN** jsonb `publicationType` = "article in edited collection" and the jsonb has no `bookType`

#### Scenario: Book with two titles and no editors stays a standalone book
- **WHEN** a ref has `publication_type = 'book'`, two titles, and no editors in `editors` or `ref_editors`
- **THEN** jsonb `publicationType` = "standalone book" and jsonb `bookType` = "monograph"

#### Scenario: Title-rule counts
- **WHEN** the migration completes against `pbdb_2026_10_18`
- **THEN** 3,045 "book/book chapter" refs and 78 "book" refs map to "article in edited collection" by the title rules, and 236 "book" refs with two titles and no editors map to "standalone book"

### Requirement: Publication title routing
The script SHALL map the legacy `pubtitle` column to a type-specific jsonb field:

| Target publicationType | jsonb field |
|---|---|
| journal article | `journalTitle` |
| serial monograph | `seriesTitle` |
| article in edited collection | `bookTitle` |
| standalone book | `title`, only when `reftitle` is absent (see Title mapping); for a "book" ref with two titles, the container note (see Container note for books with two titles); otherwise not mapped |
| edited collection | `title`, only when `reftitle` is absent (see Title mapping); otherwise not mapped |
| unpublished | (not mapped) |
| other | (not mapped) |

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

### Requirement: Additional jsonb fields
The script SHALL populate:
- `doi` from the source `doi` column (NULL if empty)
- `legacyIDs` as an object containing `oldpbdbID` from the source `reference_no` (as a string) for traceability
- `publicationYear` from the source `pubyr`
- `publisher` from the source `publisher` (for applicable publication types)
- `publicationCity` from the source `pubcity` (for applicable publication types)
- `comments` from the source `comments` column, followed by the container note where one applies (see Container note for books with two titles); omitted if both are absent

#### Scenario: DOI present
- **WHEN** a ref has `doi = '10.1234/example'`
- **THEN** the jsonb contains `doi: "10.1234/example"`

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
- Number of rows upserted
- Publication type mapping summary (count per target type)
- Number of titles taken from `pubtitle`, and each such `reference_no`
- Number of refs mapped to "article in edited collection" by each title rule ("book/book chapter", "book")
- Number of container notes written
- Warnings for: NULL publication types, non-numeric pages, unparseable otherauthors, missing authors, zero person IDs
- Elapsed time

#### Scenario: Successful migration log output
- **WHEN** the migration completes without errors
- **THEN** the console output includes start time, source counts, upsert count, pub type summary, the pubtitle fallback count, the count for each title rule, the container note count, any warnings, and elapsed time

## ADDED Requirements

### Requirement: Container note for books with two titles
A "book" ref that has two titles and no editors (see Publication type mapping) SHALL keep its `pubtitle`, `pubvol` and `pubno` in `comments` as a container note, because no field of "standalone book" holds them. The note SHALL be `Published in: <pubtitle>`, followed by `, vol. <pubvol>` when the trimmed `pubvol` is non-blank and `, no. <pubno>` when the trimmed `pubno` is non-blank. Each value SHALL be trimmed. When the ref has non-blank `comments`, the note SHALL follow them after `; `; otherwise the note SHALL be the whole `comments` value. No other ref SHALL get a container note.

#### Scenario: Note with volume and number
- **WHEN** a "book" ref with two titles and no editors has `pubtitle = 'Bulletin of the British Museum (Natural History), Zoology'`, `pubvol = '18'`, `pubno = '3'` and no comments
- **THEN** the jsonb contains `comments: "Published in: Bulletin of the British Museum (Natural History), Zoology, vol. 18, no. 3"`

#### Scenario: Note with title only
- **WHEN** a "book" ref with two titles and no editors has `pubtitle = 'Monograph of the British Eocene Flora'`, blank `pubvol` and blank `pubno`
- **THEN** the jsonb `comments` ends with `Published in: Monograph of the British Eocene Flora` and contains no `vol.` or `no.`

#### Scenario: Note follows existing comments
- **WHEN** such a ref has `comments = '49 pl.'` and `pubtitle = 'Annales du Musée d''Histoire Naturelle de Belgique'`
- **THEN** the jsonb contains `comments: "49 pl.; Published in: Annales du Musée d'Histoire Naturelle de Belgique"`

#### Scenario: A reclassified chapter gets no note
- **WHEN** a "book" ref with two titles has editors
- **THEN** its `comments` are the source `comments` only, and its `pubtitle` is in `bookTitle`

#### Scenario: Note count
- **WHEN** the migration completes against `pbdb_2026_10_18`
- **THEN** 236 refs carry a container note
