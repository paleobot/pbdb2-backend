## Why

A chapter in pbdb2 cannot say which series volume its book belongs to. Classic stores "Book title. Series name" in one `pubtitle`, with the series volume in `pubvol`. For example, "The Continental Jurassic. Museum of Northern Arizona Bulletin" is vol. 60. `article in edited collection` has only `bookTitle` and no volume field, so the migration drops `pubvol` and `pubno` on every book-type ref (`mapVolNo`).

About 2,100 Classic book-type refs carry a volume. About 63% of the 1,957 chapter-shaped ones show a series in `pubtitle`, and that is a lower bound. Without the series and its volume, many chapters can't be found or cited correctly: 217 are in NMMNH Bulletins alone.

It has to land now, before RIS. `add-ris-reference-output` would otherwise ship a `CHAP` mapping with no series. This change adds `T3` (series) and `VL` (series volume) to that mapping.

The model was settled in exploration on 2026-11-10 and recorded in `docs/api-design-backlog.md`, "Series and volumes on book-type references", with the measurements. In short:

|  | Whole volume | Part of a volume |
|---|---|---|
| **In a series** | `serial monograph` (authored or edited) | `article in edited collection` + `seriesTitle`, `seriesVolume` (new) |
| **Not in a series** | `standalone book`, `edited collection` | `article in edited collection` |

A `serial monograph` already is a whole volume in a series, so the series fields go on chapters only. Each type keeps one meaning, and no new type is needed.

## What Changes

- **The reference payload schema:** `article in edited collection` gains `seriesTitle` and `seriesVolume`. These are the existing field definitions; only the type's field list grows. The design decides whether either is required on create, and whether `seriesVolume` requires `seriesTitle`.
- **The Classic refs migration:**
  - **Split:** for a chapter whose `pubtitle` ends with a known series title after a separator, the book part goes to `bookTitle`, the series to `seriesTitle`, and `pubvol` to `seriesVolume`.
  - **Exactly a series:** a chapter whose `pubtitle` is exactly a series title gets `seriesTitle` and `seriesVolume`.
  - **Expected yield:** about 380–390 correct splits from 41 series and 128 volumes, plus most of the 290 exact-series rows.
  - **Series list:** Classic `serial monograph` titles plus additions.
  - **Exclusion list:** e.g. *Journal of Vertebrate Paleontology*, whose matches are abstracts in a supplement, and generic titles such as "Palaeontology".
- **The design settles the open questions from the backlog entry:**
  - mid-phrase matches (26)
  - what happens to an unmatched chapter's `pubvol` and `pubno`: a "Published in:" note as in `fix-book-chapter-migration` D3, or nothing
  - whether the roughly 49 whole monographs filed as chapters move to `serial monograph` here or later
  - chapters whose book title is inside `reftitle` ("X, in Y")
  - multi-volume works with no series (e.g. *Palaeontological Atlas of South-Central China* vol. 2): a note, a later `bookVolume`, or nothing
- **The PBot refs migration:** whether a PBot "contributed article in edited book" maps a series or volume is checked and decided in the design.
- **API:** no code change. The `seriesTitle` filter already matches the field on any publication type. The generated "allowed on" notes and the OpenAPI description pick up the new type from the schema.
- **Re-migration:** localhost is re-migrated with the full runner, and Aurora `pbdb2_migration_test` is rebuilt later.

No DDL change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `payload-schema-variants`: the reference type table lists `seriesTitle` and `seriesVolume` among `article in edited collection`'s fields, with any create rules the design settles.
- `refs-migration`:
  - Publication-title routing splits a chapter's `pubtitle` into book and series.
  - Volume and number mapping writes `seriesVolume` for chapters with a series, and handles an unmatched `pubvol` and `pubno` as the design decides.
  - Its counts and summary change.
- `pbot-refs-migration`: only if the design maps PBot chapter volumes.

## Impact

- **Source → target:**
  - Classic: MariaDB `pbdb_2026_10_18`.`refs` (`pubtitle`, `pubvol`, `pubno`, `reftitle`, plus `serial monograph` `pubtitle` values as the series list) → PostgreSQL `refs.reference` jsonb (`bookTitle`, `seriesTitle`, `seriesVolume`).
  - PBot refs, if the design maps them.
- **Code:**
  - `payloadSchemas/reference.schema.js` and its tests
  - `migrations/src/refs-migration/migrate-refs.js` (`mapPubtitle`, `mapVolNo`, a series matcher with its list and exclusions) and `migrations/src/tests/refs-transforms.test.js`
  - possibly `migrations/src/pbot-refs-migration/migrate-pbot-refs.js`
- **Data integrity:**
  - Chapters gain a volume that is dropped today, so the change recovers lost data.
  - **The main risk is a wrong split,** with a book title cut short or a non-series moved into `seriesTitle`. String matching was checked only on samples of 6–10 rows per group. The design requires an exclusion list and a separator before the series. Verification reviews every split by series and samples the rest.
  - `bookTitle` changes on every split row. Any client or test that matches a full "Book. Series" `bookTitle` string sees a shorter value.
  - Permids are minted on a full rebuild as before. Collections, opinions and specimens link to refs by permid, so every other runner count must reproduce exactly.
  - Migrated rows are validated by the db variant, so any new create rule does not reject legacy rows.
- **Anomalies:**
  - Classic enters chapters of one series volume as `book chapter`, `book/book chapter` and even `journal article` (e.g. "Fossil Record 3. NMMNH Bulletin" vol. 53). Only book-type rows are split. `journal article` rows are untouched, and the inconsistency is documented.
  - The legacy "NULL vs empty string" inconsistency is handled by trimming and treating blank as absent.
  - Field-conference volumes ("New Mexico Geological Society, 49th Field Conference", where 49 is the conference number) fall outside the series list.
- **Ordering:**
  - Apply after `reclassify-single-title-books`. Both edit `migrate-refs.js`, and the counts here should be measured on the reclassified data.
  - Apply before `add-ris-reference-output`, whose D5 then maps a chapter's `seriesTitle` to `T3` and `seriesVolume` to `VL`.
- **Docs:** the backlog entry is updated to point here, and the "Volume and number dropped on book-type refs" known data issue is updated with what remains.
