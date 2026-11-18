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
| NULL | "journal article" when its `pubtitle` is mostly a journal title (below); otherwise "other" | — |
| any other | "other" | — |

A ref *has two titles* when its `reftitle` and `pubtitle`, each trimmed, are both non-blank and are not equal ignoring case. (Ref 54259 has the same book title in both fields, differing only in capitalisation.) A ref *has editors* when the script's editor assembly (see Editor handling) yields a value for it.

- A "book/book chapter" ref that has two titles SHALL map to "article in edited collection". Every other "book/book chapter" ref SHALL map to "standalone book" with `bookType` "monograph", whether or not it has editors: in Classic, one title is how a whole book was stored, and almost all such refs are authored books.
- A "book" ref that has two titles and has editors SHALL map to "article in edited collection", with no `bookType`. Every other "book" ref SHALL map to "standalone book" with `bookType` "monograph".

A ref with a NULL `publication_type` (an *untyped ref*) SHALL map to "journal article" when its `pubtitle`, trimmed and lowercased, is non-blank and more than half of the Classic refs with a non-NULL `publication_type` and the same trimmed, lowercased `pubtitle` have `publication_type = 'journal article'`. Every other untyped ref SHALL map to "other". The counts SHALL be computed in the same run from the Classic refs the script reads: untyped refs SHALL NOT be counted, and PBot refs are not read. A ref mapped by this rule SHALL then have its `pubtitle`, `pubvol` and `pubno` mapped as any "journal article" (see Publication title routing, Volume and number mapping).

No legacy value SHALL map to "edited collection". That type remains in the reference source's enum for PBot refs and for references created through the API.

The mapping SHALL be a table in the script, with these two title rules and the untyped-ref rule beside it; none SHALL be read from `dictionaries`.

#### Scenario: Direct mapping
- **WHEN** a ref has `publication_type = 'journal article'`
- **THEN** jsonb `publicationType` = "journal article", and the row written has no `reference_type_id` column

#### Scenario: Standalone book with bookType
- **WHEN** a ref has `publication_type = 'Ph.D. thesis'`
- **THEN** jsonb `publicationType` = "standalone book" and jsonb `bookType` = "Ph.D. thesis"

#### Scenario: Untyped ref with a journal's title is a journal article
- **WHEN** a ref has `publication_type = NULL`, `pubtitle = 'Nature'`, `pubvol = '316'` and `pubno = '6'`, and most typed Classic refs with `pubtitle` "nature" (ignoring case) are journal articles
- **THEN** jsonb `publicationType` = "journal article", with `journalTitle: "Nature"`, `journalVolume: "316"` and `journalNumber: "6"`

#### Scenario: Untyped ref whose title is mostly a series stays other
- **WHEN** a ref has `publication_type = NULL` and `pubtitle = 'United States Geological Survey Professional Paper'`, and 153 of the 336 typed Classic refs with that `pubtitle` are journal articles
- **THEN** jsonb `publicationType` = "other"

#### Scenario: Exactly half is not a majority
- **WHEN** an untyped ref's `pubtitle` is shared by two typed Classic refs, one "journal article" and one "serial monograph"
- **THEN** jsonb `publicationType` = "other"

#### Scenario: Untyped ref with an unmatched or blank title stays other
- **WHEN** a ref has `publication_type = NULL` and a blank `pubtitle`, or a `pubtitle` no typed Classic ref has
- **THEN** jsonb `publicationType` = "other"

#### Scenario: Untyped refs do not vote
- **WHEN** ten untyped refs and one typed "serial monograph" ref share a `pubtitle`
- **THEN** none of the untyped refs maps to "journal article"

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
- **THEN** 3,045 "book/book chapter" refs and 78 "book" refs map to "article in edited collection" by the title rules, 665 "book/book chapter" refs without two titles map to "standalone book", 236 "book" refs with two titles and no editors map to "standalone book", 658 of the 1,183 untyped refs map to "journal article", and no PBDB ref maps to "edited collection"

### Requirement: Publication title routing
The script SHALL map the legacy `pubtitle` column to a type-specific jsonb field:

| Target publicationType | jsonb field |
|---|---|
| journal article | `journalTitle` |
| serial monograph | `seriesTitle` |
| article in edited collection | `bookTitle` |
| standalone book | `title`, only when `reftitle` is absent (see Title mapping); otherwise, when it differs from `title` ignoring case, the container note (see Container note) |
| edited collection | `title`, only when `reftitle` is absent (see Title mapping); otherwise, when it differs from `title` ignoring case, the container note. No PBDB ref maps to this type (see Publication type mapping) |
| unpublished | the container note |
| other | the container note |

A ref that maps to "article in edited collection" by a title rule routes its `pubtitle` to `bookTitle` like any other, and an untyped ref that maps to "journal article" routes it to `journalTitle`. No non-blank `pubtitle` SHALL be dropped: it SHALL be in a field, be the ref's `title`, or be in the container note.

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
- **THEN** its `pubtitle` is not written to any jsonb field or to the container note

#### Scenario: Abstract pubtitle goes to the note
- **WHEN** a ref with `publication_type = 'abstract'` has `pubtitle = 'Journal of Vertebrate Paleontology'`
- **THEN** it maps to "other", the jsonb has no `journalTitle`, and its `comments` contain `Published in: Journal of Vertebrate Paleontology`

#### Scenario: Thesis institution goes to the note
- **WHEN** a ref with `publication_type = 'Ph.D. thesis'` has `reftitle = 'Evolution and classification of the Bibionidae (Diptera: Bibionomorpha)'` and `pubtitle = 'Doctoral Dissertation, Oregon State University'`
- **THEN** its `comments` contain `Source: Doctoral Dissertation, Oregon State University`

### Requirement: Volume and number mapping
The script SHALL map `pubvol` to `journalVolume` (journal articles) or `seriesVolume` (serial monographs), and `pubno` to `journalNumber` (journal articles) or `seriesNumber` (serial monographs). A ref of any other target type SHALL get no volume or number field; its non-blank `pubvol` and `pubno` SHALL be kept in its container note instead (see Container note).

#### Scenario: Journal volume and number
- **WHEN** a ref maps to "journal article" with `pubvol = '42'` and `pubno = '3'`
- **THEN** the jsonb contains `journalVolume: "42"` and `journalNumber: "3"`

#### Scenario: Serial monograph volume and number
- **WHEN** a ref maps to "serial monograph" with `pubvol = '105'` and `pubno = '3'`
- **THEN** the jsonb contains `seriesVolume: "105"` and `seriesNumber: "3"`, and its `comments` are the source `comments` only

#### Scenario: Chapter volume goes to the note
- **WHEN** a ref maps to "article in edited collection" with `pubvol = '60'`
- **THEN** the jsonb contains no `journalVolume`, `seriesVolume` or `journalNumber`, and its `comments` end with `, vol. 60`

#### Scenario: Whole-book volume goes to the note
- **WHEN** a ref maps to "standalone book" with a blank `reftitle`, `pubtitle = 'Catalogue of the Fossil Mammalia in the British Museum'` and `pubvol = '5'`
- **THEN** the jsonb has no volume field, and its `comments` end with `Published as vol. 5`

### Requirement: Container note
Every ref SHALL keep in `comments`, as a container note, each Classic container value that no field of its built jsonb holds. The values are the trimmed `pubtitle`, `pubvol` and `pubno`; a blank value is absent.

A value is *held* when:
- `pubtitle`: the jsonb has it as `journalTitle`, `seriesTitle` or `bookTitle`, or its `title` equals it ignoring case;
- `pubvol`: the jsonb has it as `journalVolume` or `seriesVolume`;
- `pubno`: the jsonb has it as `journalNumber` or `seriesNumber`.

A ref SHALL get a note when at least one of its values is not held, and no note otherwise. "Held" SHALL be decided from the jsonb the script built, after type, title and field mapping.

The note's *list* SHALL be, in order and joined with `, `:
- the `pubtitle`, unless it is absent or equals the jsonb `title` ignoring case;
- `vol. <pubvol>`, when present;
- `no. <pubno>`, when present.

The note SHALL be the list with the first matching prefix:

| Prefix | When |
|---|---|
| `Source: ` | the list includes the `pubtitle`, and the target type is "unpublished", or "standalone book" with `bookType` "Ph.D. thesis", "M.S. thesis" or "compendium" |
| `Published in: ` | the list includes the `pubtitle`, or the target type is "article in edited collection" or "other" |
| `Published as ` | otherwise |

When the ref has non-blank `comments`, the note SHALL follow them after `; `; otherwise the note SHALL be the whole `comments` value.

#### Scenario: Note with volume and number
- **WHEN** a "book" ref with two titles and no editors has `pubtitle = 'Bulletin of the British Museum (Natural History), Zoology'`, `pubvol = '18'`, `pubno = '3'` and no comments
- **THEN** the jsonb contains `comments: "Published in: Bulletin of the British Museum (Natural History), Zoology, vol. 18, no. 3"`

#### Scenario: Note with title only
- **WHEN** a "book" ref with two titles and no editors has `pubtitle = 'Monograph of the British Eocene Flora'`, blank `pubvol` and blank `pubno`
- **THEN** the jsonb `comments` ends with `Published in: Monograph of the British Eocene Flora` and contains no `vol.` or `no.`

#### Scenario: Note follows existing comments
- **WHEN** such a ref has `comments = '49 pl.'` and `pubtitle = 'Annales du Musée d''Histoire Naturelle de Belgique'`
- **THEN** the jsonb contains `comments: "49 pl.; Published in: Annales du Musée d'Histoire Naturelle de Belgique"`

#### Scenario: Chapter with a volume
- **WHEN** a "book chapter" ref has `pubtitle = 'The Continental Jurassic. Museum of Northern Arizona Bulletin'`, `pubvol = '60'`, blank `pubno` and no comments
- **THEN** the jsonb contains `bookTitle: "The Continental Jurassic. Museum of Northern Arizona Bulletin"` and `comments: "Published in: The Continental Jurassic. Museum of Northern Arizona Bulletin, vol. 60"`

#### Scenario: Chapter with a number only
- **WHEN** a ref that maps to "article in edited collection" has a non-blank `pubtitle`, blank `pubvol` and `pubno = '2'`
- **THEN** its note is `Published in: <pubtitle>, no. 2`

#### Scenario: Chapter note follows existing comments
- **WHEN** a "book chapter" ref with `pubvol = '21'` has `comments = 'pl. 3'`
- **THEN** its jsonb `comments` starts with `pl. 3; Published in: ` and ends with `, vol. 21`

#### Scenario: Chapter with a volume but no publication title
- **WHEN** a "book chapter" ref has a blank `pubtitle`, `pubvol = '3'` and `pubno = '2'`
- **THEN** the jsonb contains `comments: "Published in: vol. 3, no. 2"` and no `bookTitle`

#### Scenario: Chapter by the title rules gets a note
- **WHEN** a "book" ref with two titles and editors, or a "book/book chapter" ref with two titles, has `pubvol = '14'`
- **THEN** it maps to "article in edited collection", its `pubtitle` is in `bookTitle`, and its `comments` end with `, vol. 14`

#### Scenario: Chapter without volume or number gets no note
- **WHEN** a ref that maps to "article in edited collection" has blank `pubvol` and blank `pubno`
- **THEN** its `comments` are the source `comments` only, and its `pubtitle` is in `bookTitle`

#### Scenario: Abstract keeps its venue
- **WHEN** a ref with `publication_type = 'abstract'` has `pubtitle = 'Geological Society of America Abstracts with Programs'`, `pubvol = '29'`, blank `pubno` and no comments
- **THEN** it maps to "other" and the jsonb contains `comments: "Published in: Geological Society of America Abstracts with Programs, vol. 29"`

#### Scenario: Untyped ref left as other keeps its container
- **WHEN** an untyped ref maps to "other" and has `pubtitle = 'Geologisches Jahrbuch, Beihefte'` and `pubvol = '85'`
- **THEN** its note is `Published in: Geologisches Jahrbuch, Beihefte, vol. 85`

#### Scenario: Other with a volume but no publication title
- **WHEN** a ref that maps to "other" has a blank `pubtitle` and `pubvol = '7'`
- **THEN** its note is `Published in: vol. 7`

#### Scenario: Thesis source
- **WHEN** a ref with `publication_type = 'Ph.D. thesis'` has `reftitle = 'Anatomy, phylogeny, and palaeoecology of the basal thalattosuchians (Mesoeucrocodylia) from the Liassic of Central Europe'`, `pubtitle = 'PhD dissertation, Johannes Gutenberg-Universität Mainz'` and no comments
- **THEN** the jsonb contains `comments: "Source: PhD dissertation, Johannes Gutenberg-Universität Mainz"`

#### Scenario: Unpublished source
- **WHEN** a ref with `publication_type = 'unpublished'` has `pubtitle = 'pers. comm.'` and `comments = 'Primary collection data'`
- **THEN** the jsonb contains `comments: "Primary collection data; Source: pers. comm."`

#### Scenario: Compendium source with a volume
- **WHEN** a ref with `publication_type = 'compendium'` has `reftitle = 'Available generic names for trilobites'`, `pubtitle = 'Memoirs of the Queensland Museum'`, `pubvol = '48'` and `pubno = '2'`
- **THEN** its note is `Source: Memoirs of the Queensland Museum, vol. 48, no. 2`

#### Scenario: Guidebook in a field-conference volume
- **WHEN** a ref with `publication_type = 'guidebook'` has `reftitle = 'Guide to the Late Pennsylvanian paleontology of the Upper Madera Formation'`, `pubtitle = 'New Mexico Geological Society Guidebook'` and `pubvol = '47'`
- **THEN** its note is `Published in: New Mexico Geological Society Guidebook, vol. 47`

#### Scenario: Whole book with its own volume
- **WHEN** a "book" ref has a blank `reftitle`, `pubtitle = 'Die Saugetiere'`, `pubvol = 'II'` and no comments
- **THEN** it maps to "standalone book" with `title: "Die Saugetiere"`, and the jsonb contains `comments: "Published as vol. II"`

#### Scenario: Own title is not repeated
- **WHEN** a "book/book chapter" ref has `reftitle` and `pubtitle` equal ignoring case and `pubvol = '2'`
- **THEN** its note is `Published as vol. 2`, without the title

#### Scenario: Fully held values get no note
- **WHEN** a ref maps to "journal article" or "serial monograph", whatever its `pubtitle`, `pubvol` and `pubno`
- **THEN** its `comments` are the source `comments` only

#### Scenario: Single-title book without a volume gets no note
- **WHEN** a ref maps to "standalone book", its `pubtitle` is blank or equal to its `title` ignoring case, and its `pubvol` and `pubno` are blank
- **THEN** its `comments` are the source `comments` only

#### Scenario: Note count
- **WHEN** the migration completes against `pbdb_2026_10_18`
- **THEN** 5,220 refs carry a container note: 1,907 that map to "article in edited collection" and 236 two-title "book" refs, byte-identical to before this rule was generalized, and 3,077 others (2,449 "other", 171 guidebooks, 142 theses, 80 compendia and 46 "unpublished", and 189 whole works `Published as`)

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
- Number of untyped refs mapped to "journal article" by the untyped-ref rule, and the number left "other"
- Number of container notes written, per prefix (`Published in`, `Source`, `Published as`) and target type, with `bookType` for "standalone book"
- Number of rows written to the single-title books review list, split by Classic type ("book/book chapter", "book"), and the number of rows carrying each signal
- Number of rows written to the untyped refs review list, split by target type
- DOI summary: the number of DOIs normalized (a prefix was removed), the number kept for each kept verdict and for unaudited, and the number dropped for each dropped verdict and for unaudited-malformed
- Warnings for: non-numeric pages, unparseable otherauthors, missing authors, zero person IDs, unaudited DOIs
- Elapsed time

#### Scenario: Successful migration log output
- **WHEN** the migration completes without errors
- **THEN** the console output includes start time, source counts, the verdict-file row count, upsert count, pub type summary, the pubtitle fallback count, the count for each title rule, the count of single-title "book/book chapter" refs mapped to "standalone book", the untyped-ref counts, the container note counts per prefix and target type, the review-list row count by Classic type with a count per signal, the untyped review-list row count by target type, the DOI summary, any warnings, and elapsed time

#### Scenario: DOI summary adds up
- **WHEN** the migration completes
- **THEN** the DOI summary's kept and dropped counts sum to the number of refs with a non-blank `doi`

#### Scenario: Container note counts add up
- **WHEN** the migration completes
- **THEN** the container note counts per prefix and target type sum to the number of refs whose `comments` gained a note

## ADDED Requirements

### Requirement: Review list of untyped refs
Classic refs with a NULL `publication_type` were typed by the script (see Publication type mapping) or left "other", and curators check and retype them after migration. On every run, after the upsert, the script SHALL write a review list of every untyped ref, whatever type it got.

The list SHALL be written to `src/refs-migration/untyped-refs-review.csv`, beside the script, and is a version-controlled file: it SHALL NOT be gitignored. It SHALL be UTF-8 CSV with the header

`reference_no,permid,type,journal_share,authors,year,title,pubtitle,pubvol,pubno`

and one row per untyped ref, sorted by `reference_no` ascending:

| Column | Value |
|---|---|
| `reference_no` | the Classic `reference_no` |
| `permid` | the ref's permid |
| `type` | the migrated `publicationType`: "journal article" or "other" |
| `journal_share` | `<journal>/<typed>`: the number of typed Classic refs with the same trimmed, lowercased `pubtitle` that are "journal article", and the number of all such typed refs; blank when the `pubtitle` is blank or no typed ref has it |
| `authors` | the migrated authors' family names in order, joined by `; ` |
| `year` | the migrated `publicationYear`, blank when absent |
| `title` | the migrated `title`, blank when absent |
| `pubtitle` | the trimmed Classic `pubtitle`, blank when blank |
| `pubvol` | the trimmed Classic `pubvol`, blank when blank |
| `pubno` | the trimmed Classic `pubno`, blank when blank |

Fields SHALL be quoted exactly as in the single-title books review list. The file SHALL contain nothing that varies between runs over the same source data, so that an unchanged source rewrites it byte for byte.

#### Scenario: An untyped journal article is listed with its share
- **WHEN** an untyped ref with `pubtitle = 'Annals of the South African Museum'` maps to "journal article", and 111 of the 114 typed Classic refs with that `pubtitle` are journal articles
- **THEN** the list has a row for it with `type` = "journal article" and `journal_share` = "111/114"

#### Scenario: An untyped ref left other is listed
- **WHEN** an untyped ref has a `pubtitle` no typed Classic ref has
- **THEN** the list has a row for it with `type` = "other" and a blank `journal_share`

#### Scenario: Typed refs are never listed
- **WHEN** a ref has a non-NULL `publication_type`
- **THEN** the list has no row for it

#### Scenario: Row count
- **WHEN** the migration completes against `pbdb_2026_10_18`
- **THEN** the list has 1,183 rows: 658 "journal article" and 525 "other"

#### Scenario: Unchanged source rewrites an identical file
- **WHEN** the migration is run twice over the same source data
- **THEN** the second run's `untyped-refs-review.csv` is byte-identical to the first
