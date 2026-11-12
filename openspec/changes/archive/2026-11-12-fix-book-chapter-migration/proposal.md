## Why

The refs migration maps every Classic `book/book chapter` ref to `edited collection`. But 3,045 of the 3,710 have a `reftitle` and a different `pubtitle`: a chapter, and the book it appears in. They have the same shape as Classic's own `book chapter` rows. Because `edited collection` has no field for `pubtitle`, the book title of each of those chapters is dropped. That is data loss in a migration whose rule is that records must not be lost. It came to light while planning RIS output for references, where these rows would be exported as whole books with the chapter's authors as editors.

## What Changes

- A Classic `book/book chapter` ref whose `reftitle` and `pubtitle` are both non-blank and differ (after trimming) migrates as `article in edited collection`, with `bookTitle` taken from `pubtitle`. There are 3,045 of them in `pbdb_2026_10_18`.
- Every other `book/book chapter` ref stays `edited collection`, as today: `pubtitle` only (618), equal titles (16), `reftitle` only (15), and neither (16). The `pubtitle` title fallback for whole books is unchanged.
- The publication-type mapping becomes a rule on the type plus the shape of the titles for this one Classic type, instead of a lookup on the type alone. Every other Classic type keeps its fixed mapping.
- Classic `book` refs with both titles and a different `pubtitle` (314; they now become `standalone book` with `pubtitle` dropped) are examined in this change too. A sample shows they are mixed:
  - chapters in edited or authored volumes ("General remarks upon Coleoptera of Lake Superior" in *Lake Superior: Its Physical Character…*, ed. L. Agassiz)
  - articles in journals or series (*Norsk Geologiske Tidsskrift*, *Bulletin of the British Museum (Natural History)*)
  - monographs in a series
  - at least one publisher entered as `pubtitle`
  
  78 have editors and 144 start after page 1. No title-shape rule sorts them cleanly. The design decides whether they get a narrower rule, keep `pubtitle` in some form, or stay as they are with the loss documented.
- The localhost database is re-migrated with the full runner. Aurora `pbdb2_migration_test` is rebuilt later.

No API, schema or DDL change: `article in edited collection` and `bookTitle` already exist.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `refs-migration`: the publication-type mapping for `book/book chapter` depends on the titles; publication-title routing gives the reclassified chapters a `bookTitle`; the mapping summary and counts in its scenarios change; the outcome for Classic `book` refs with two titles is specified.

## Impact

- **Source → target:** MariaDB `pbdb_2026_10_18`.`refs` (`publication_type`, `reftitle`, `pubtitle`, `editors`) → PostgreSQL `refs.reference` jsonb (`publicationType`, `title`, `bookTitle`). `ref_authors` and `ref_editors` are unaffected.
- **Code:** `migrations/src/refs-migration/migrate-refs.js` (`PUB_TYPE_MAP` / `mapPublicationType`, `mapPubtitle`) and its tests. The PBot refs migration is unaffected, because PBot has no `book/book chapter`.
- **Data integrity:**
  - 3,045 refs change `publicationType` and gain a `bookTitle` that is lost today. Nothing else in those rows changes.
  - Permids are minted on a full rebuild as before, and nothing downstream keys on publication type. Collections, opinions and specimens link to refs by permid, so the re-run must reproduce every other count exactly. The runner's assertions check this.
  - Migrated rows are validated by the db variant, not the create rules. So the 1,761 reclassified chapters with no editors (which `article in edited collection` requires on create) still load. They will fail create-time rules if edited later; that is the same as other legacy rows today.
- **Anomalies:**
  - Unchanged: the 1,201 NULL `publication_type` refs (anomaly report) still map to `other`.
  - Relevant: legacy PBDB is inconsistent about which title field it uses ("NULL vs empty string" and free-text conventions). The shape rule treats blank and NULL the same and trims before comparing.
- **API:** no code change. Reads, filters (`publicationType`, `bookTitle`) and the CSV export reflect the new values after the re-run.
- **Follow-up:** RIS output for references, planned as a separate change, depends on this one. Once this is done, chapters export as `CHAP` with the book title in `T2`.
