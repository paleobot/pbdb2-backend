## Why

The refs migration drops the volume and number of every Classic chapter. `article in edited collection` has `bookTitle` but no volume field, so `mapVolNo` discards `pubvol` and `pubno`. In `pbdb_2026_10_18`, 1,907 chapter-shaped refs carry one or both:

| Carries | Refs |
|---|---:|
| volume only | 1,678 |
| volume and number | 173 |
| number only | 50 |
| volume or number, but no `pubtitle` | 6 |

The volume usually belongs to a series named inside `pubtitle`, as in "The Continental Jurassic. Museum of Northern Arizona Bulletin", vol. 60. The first plan was to split `pubtitle` into a book title and a series and write the volume to new `seriesTitle`/`seriesVolume` fields on chapters. A spike on 2026-11-13 showed the split can't be done reliably:
- The series list, built from Classic `serial monograph` titles, holds publishers, institutions, journals, generic words ("Geology", "Palaeontology"), multi-volume books and book-plus-series strings.
- About 10–20% of splits came out wrong.
- Matching exactly on a non-series moves a real book title out of `bookTitle`.

A curated allow list would fix the list, but the cut is still a guess on data Classic never structured. So this change keeps the volume and number without interpreting them. The model question of how a chapter records the series its book belongs to stays open in `docs/api-design-backlog.md`. Curators can fill series fields on real records once that is decided.

## What Changes

- **The Classic refs migration:** a chapter, meaning a ref that migrates as `article in edited collection`, with a non-blank `pubvol` or `pubno` gets a container note in `comments`, as the two-title `book` refs already do (`fix-book-chapter-migration` D3).
  - `bookTitle` stays the whole `pubtitle`, unchanged.
  - The note is added after any existing `comments` with `; `, as for books.
  - Chapters with neither a volume nor a number get no note.
  - **The design settles the wording:** repeat the `pubtitle` (`Published in: <pubtitle>, vol. 60, no. 3`, one format with the book note and readable on its own) or give only the volume and number. The design also settles the six chapters with no `pubtitle`.
- **Migration logging:** the count of container notes is split into books and chapters.
- **Not changed:**
  - the reference payload schema: no new fields or create rules
  - `pubtitle` parsing: no series list, no exclusion list
  - the PBot refs migration: 1 of 18 PBot chapters has a volume, so it is left as is and recorded
  - the API and RIS
- **Docs:** the backlog entry "Series and volumes on book-type references" records the spike, why the split was dropped, and the open model question. The "Volume and number dropped on book-type refs" known data issue is updated to cover what remains, mainly whole books with a volume.

No DDL change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `refs-migration`:
  - Container note: chapters with a volume or number get one too.
  - Its logging changes.

## Impact

- **Source → target:** Classic MariaDB `pbdb_2026_10_18`.`refs` (`pubtitle`, `pubvol`, `pubno`, `comments`) → PostgreSQL `refs.reference` jsonb `comments`.
- **Code:** `migrations/src/refs-migration/migrate-refs.js` (`containerNote` and its caller) and `migrations/src/tests/refs-transforms.test.js`.
- **Data integrity:**
  - About 1,900 chapters gain their volume or number, which is dropped today. No other field changes.
  - Permids are minted on a full rebuild as before. Every runner count must reproduce exactly.
  - `comments` is free text in the `db` variant, so validation is unaffected.
- **Limits:**
  - The volume is text in `comments`, not a field. Filters and RIS don't see it: a chapter exports as `CHAP` with `T2` = `bookTitle` and no `VL`.
  - Whole books (`standalone book`) with a volume still lose it, apart from the 236 that already get a note. That's recorded as a known data issue, not fixed here.
- **Ordering:** independent of `add-ris-reference-output`, which no longer waits on this change. Apply after `reclassify-single-title-books` (archived), whose types decide which refs are chapters.
- **Re-migration:** localhost is re-migrated with the full runner. Aurora `pbdb2_migration_test` is rebuilt later.
