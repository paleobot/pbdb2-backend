## Why

The refs migration drops a Classic ref's container data (`pubtitle`, `pubvol`, `pubno`) whenever its target type has no field to hold it and no container note applies. On 2026-11-18, a ref-by-ref comparison of `pbdb_2026_10_18` with localhost found 4,599 refs losing at least one value:

| pbdb2 type | Classic type | Refs | `pubtitle` lost | `pubvol` lost | `pubno` lost |
|---|---|---:|---:|---:|---:|
| other | abstract | 1,835 | 1,823 | 1,327 | 1,040 |
| other | (NULL) | 1,183 | 1,183 | 1,030 | 293 |
| other | news article | 88 | 85 | 67 | 43 |
| other | instcoll | 9 | 9 | 0 | 0 |
| serial monograph | serial monograph | 3,564 | 0 | 0 | 863 |
| standalone book | book | 1,616 | 0 | 122 | 35 |
| standalone book | book/book chapter | 665 | 1 | 49 | 16 |
| standalone book | guidebook | 210 | 171 | 52 | 6 |
| standalone book | Ph.D. thesis | 262 | 95 | 11 | 3 |
| standalone book | M.S. thesis | 173 | 47 | 4 | 1 |
| standalone book | compendium | 111 | 80 | 9 | 2 |
| unpublished | unpublished | 248 | 46 | 2 | 1 |

What gets lost:
- **Abstracts** lose the meeting or journal they appeared in, e.g. *Journal of Vertebrate Paleontology* (623 refs) or *GSA Abstracts with Programs*.
- **Untyped refs.** Classic refs with a NULL `publication_type`, all entered 1999–2005 (827 in 2002), are mostly plain journal articles: *Nature*, *C. R. Acad. Sci. Paris* 316: 839. They migrate as `other` and lose the journal, volume and number. For 676 of them, the `pubtitle` exactly matches, ignoring case, the `pubtitle` of a Classic `journal article` ref. 666 of those 676 have a volume. For 658, `journal article` is the majority type among typed Classic refs with that pubtitle.
- **Serial monographs** lose their series number (*Bulletin AMNH* 105, no. 3). `journal article` has `journalNumber`, but `serial monograph` has no counterpart.
- **Theses** lose the degree and institution ("PhD dissertation, Johannes Gutenberg-Universität Mainz").
- **Guidebooks** lose the field-conference volume.
- **Compendia** lose the database ("MolluscaBase (2015)").
- **Unpublished refs** lose the source ("pers. comm.", a URL).

These gaps were found while planning `add-ris-reference-output`, which exports each ref as it is stored. If RIS ships first, an abstract would export with no venue, and an untyped journal article as `GEN` with no journal. This change runs first, so that the migration is as complete as it can be before RIS.

## What Changes

- **Classic refs migration: the container note becomes general.**
  - Today only two-title `book` refs and chapters get a container note (`fix-book-chapter-migration`, `keep-chapter-volume-in-note`).
  - With this change, any ref keeps, in a container note in `comments`, any non-blank `pubtitle`, `pubvol` or `pubno` that no field of its target type holds.
  - Chapters and two-title books keep their current notes unchanged.
  - 3,077 refs gain a note (design D4).
  - The design settles the note's wording for types where "Published in:" reads badly, such as "pers. comm." on an unpublished ref or a degree on a thesis.
- **Classic refs migration: some untyped refs become journal articles.**
  - The rule: a NULL-type ref whose trimmed `pubtitle`, ignoring case, belongs mostly (more than half) to Classic `journal article` refs. The majority test drops the false positives that a bare exact match lets in, such as *USGS Professional Paper* and *GSA Memoir* (design D1).
  - The other `journal article` rules then apply: `journalTitle`, `journalVolume`, `journalNumber`.
  - That's 658 refs in `pbdb_2026_10_18`. The remaining 525 stay `other` with a container note.
  - This is the first rule that decides a type from `pubtitle`. Unlike the edited-volume question (`reclassify-single-title-books`), it has strong evidence: an exact match, confirmed by majority, against about 80,000 journal articles.
- **Classic refs migration: review list of untyped refs.** Every run writes a review list of the NULL-type refs and the type each one got, so curators can check the rule and retype the rest. The design settles its file name and columns.
- **Reference payload schema: `serial monograph` gains `seriesNumber`.**
  - It mirrors `journalNumber`: a string of at most 10 characters, optional on create, and allowed in every variant that allows `seriesVolume`.
  - The Classic migration maps `pubno` to it for serial monographs (863 refs).
  - The API's JSON, CSV columns and OpenAPI description pick it up from the schema.
- **PBot refs migration:** `publicationNumber` maps to `seriesNumber` for serial monographs, as `publicationVolume` already maps to `seriesVolume`. Today's PBot data has no serial monographs, so nothing changes now, but PBot keeps running after pbdb2 goes live and will be migrated again.
- **Docs:** `docs/api-design-backlog.md` "Known data issues" is updated. Whole books with a volume no longer lose it, and the untyped refs get an entry.

No DDL change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `refs-migration`:
  - Publication type mapping: the NULL-type journal rule.
  - Container note: generalized to every type, and its count updated.
  - Volume and number mapping: `pubno` → `seriesNumber`, and leftovers point to the note.
  - Publication title routing: the "not mapped" rows point to the note.
  - Migration logging.
  - A new requirement for the untyped-refs review list.
- `payload-schema-variants`: the per-type field table adds `seriesNumber` to `serial monograph`, which is not required on create.
- `pbot-refs-migration`: field mapping row `publicationNumber` → `seriesNumber` for serial monographs.

## Impact

- **Source → target:**
  - Classic MariaDB `pbdb_2026_10_18`.`refs` (`publication_type`, `pubtitle`, `pubvol`, `pubno`, `comments`) → PostgreSQL `refs.reference` jsonb (`publicationType`, `journalTitle`, `journalVolume`, `journalNumber`, `seriesNumber`, `comments`).
  - PBot `Reference.publicationNumber` → `seriesNumber`.
  - Type mappings: all values are strings to jsonb strings. `pubvol` and `pubno` are `varchar(10)`, which fits the 10-character limit.
- **Code:**
  - `payloadSchemas/reference.schema.js` and its tests
  - `migrations/src/refs-migration/migrate-refs.js` (`mapPublicationType`, `mapVolNo`, `containerNote`, the review list) and `migrations/src/tests/refs-transforms.test.js`
  - `migrations/src/pbot-refs-migration/migrate-pbot-refs.js`
- **API:** additive only. `seriesNumber` appears on serial monographs in JSON, CSV and OpenAPI. 658 refs change `publicationType` from `other` to `journal article`, so type filters and counts shift. Their permids are unchanged, because a permid comes from the Classic `reference_no`.
- **Data integrity:**
  - No value is removed. Each change either moves a dropped value into a field or a note, or changes the type of an untyped ref.
  - **Risk: a wrong match.** The title match can type a non-article as `journal article`, for example a book in a series whose title is also a journal title. The review list makes each case visible, and the majority test removes the false positives found in a sample of the 676 exact matches.
  - **Risk: a duplicated value.** A value must land in exactly one place. A note must not repeat a value a field already holds, and the existing chapter and two-title-book notes must not change. The design defines "held by a field" per type, and the tests check that no value is both stored and noted.
  - **Count:** every runner total must reproduce exactly, except per-type reference counts, which shift by the 658.
- **Anomalies:** "NULL vs empty string vs 0 used inconsistently for 'no value'" (anomaly report, MEDIUM) applies to `publication_type` (NULL) and to `pubtitle`, `pubvol` and `pubno` (NULL or blank). Each is trimmed and treated as absent when blank, as now.
- **Ordering:** this change runs before `add-ris-reference-output`. Its proposal and design gain `seriesNumber` → `IS` for `SER`, and their stale dependency text is fixed at that point.
- **Re-migration:** localhost is re-migrated with the full runner. Aurora `pbdb2_migration_test` is rebuilt later, together with the DOI refresh.
