## RENAMED Requirements

- FROM: `### Requirement: Container note for books with two titles`
- TO: `### Requirement: Container note`

## MODIFIED Requirements

### Requirement: Container note
Two kinds of ref SHALL keep their Classic container in `comments` as a container note, because no field of their target type holds all of it:
- a "book" ref that has two titles and no editors (see Publication type mapping), which maps to "standalone book", SHALL always get a note;
- a ref that maps to "article in edited collection" SHALL get a note when its trimmed `pubvol` or trimmed `pubno` is non-blank. Its `pubtitle` SHALL still go to `bookTitle` (see Publication title routing).

The note SHALL be `Published in: ` followed by, in order and joined with `, `:
- the trimmed `pubtitle`, when non-blank;
- `vol. <pubvol>`, when the trimmed `pubvol` is non-blank;
- `no. <pubno>`, when the trimmed `pubno` is non-blank.

Each value SHALL be trimmed. When the ref has non-blank `comments`, the note SHALL follow them after `; `; otherwise the note SHALL be the whole `comments` value. No other ref SHALL get a container note.

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

#### Scenario: Other types get no note
- **WHEN** a ref maps to "journal article", "serial monograph", "standalone book" (other than a two-title "book" without editors), or "other", whatever its `pubvol` and `pubno`
- **THEN** its `comments` are the source `comments` only

### Requirement: Volume and number mapping
The script SHALL map `pubvol` to `journalVolume` (journal articles) or `seriesVolume` (serial monographs), and `pubno` to `journalNumber` (journal articles only). A ref that maps to "article in edited collection" SHALL get no volume or number field; its `pubvol` and `pubno` SHALL be kept in its container note instead (see Container note).

#### Scenario: Journal volume and number
- **WHEN** a ref maps to "journal article" with `pubvol = '42'` and `pubno = '3'`
- **THEN** the jsonb contains `journalVolume: "42"` and `journalNumber: "3"`

#### Scenario: Serial monograph volume
- **WHEN** a ref maps to "serial monograph" with `pubvol = '15'`
- **THEN** the jsonb contains `seriesVolume: "15"`

#### Scenario: Chapter volume goes to the note
- **WHEN** a ref maps to "article in edited collection" with `pubvol = '60'`
- **THEN** the jsonb contains no `journalVolume`, `seriesVolume` or `journalNumber`, and its `comments` end with `, vol. 60`

### Requirement: Migration logging
The script SHALL log:
- Start and completion messages with timestamps
- Source row counts (refs, ref_authors, ref_editors)
- Number of rows upserted
- Publication type mapping summary (count per target type)
- Number of titles taken from `pubtitle`, and each such `reference_no`
- Number of refs mapped to "article in edited collection" by each title rule ("book/book chapter", "book")
- Number of "book/book chapter" refs mapped to "standalone book" because they lack two titles
- Number of container notes written, split into "book" refs with two titles and no editors, and refs that map to "article in edited collection"
- Number of rows written to the single-title books review list, split by Classic type ("book/book chapter", "book"), and the number of rows carrying each signal
- Warnings for: NULL publication types, non-numeric pages, unparseable otherauthors, missing authors, zero person IDs
- Elapsed time

#### Scenario: Successful migration log output
- **WHEN** the migration completes without errors
- **THEN** the console output includes start time, source counts, upsert count, pub type summary, the pubtitle fallback count, the count for each title rule, the count of single-title "book/book chapter" refs mapped to "standalone book", the container note counts for books and for chapters, the review-list row count by Classic type with a count per signal, any warnings, and elapsed time
