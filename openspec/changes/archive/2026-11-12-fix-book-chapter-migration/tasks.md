## 1. Baseline

- [x] 1.1 Record the current localhost totals before changing anything: the runner's per-step counts and assertions from the last full run, and the refs publication-type summary (`SELECT reference->>'publicationType', count(*) FROM refs GROUP BY 1`, split by `legacyIDs.oldpbdbID` vs `legacyIDs.pbotID`).
- [x] 1.2 Confirm the source counts the specs assert against `pbdb_2026_10_18`: 3,045 "book/book chapter" refs with two titles, 78 "book" refs with two titles and editors (`editors` or `ref_editors`), and 236 with two titles and no editors. If any count differs, stop and reconcile the specs first.

## 2. Make the transforms testable

- [x] 2.1 In `migrations/src/refs-migration/migrate-refs.js`, guard `main()` so it runs only when the script is invoked directly, as `migrate-collections.js` does, and export the pure transforms the new tests need (`mapPublicationType`, `mapPubtitle`, `buildEditors`, and the new helpers below).
- [x] 2.2 Check that the runner still invokes the script and that `npm test` still passes, with no behaviour change yet.

## 3. Title rules (D1, D2)

- [x] 3.1 Add `hasTwoTitles(ref)`: `reftitle` and `pubtitle`, each trimmed, both non-blank and not equal ignoring case.
- [x] 3.2 Add `classifyByTitles(ref, editors)` beside `PUB_TYPE_MAP`. It returns `article in edited collection` (no `bookType`) for a "book/book chapter" ref with two titles, and for a "book" ref with two titles and editors. Otherwise it returns nothing, so the table applies.
- [x] 3.3 Change `mapPublicationType` to take the source row and the assembled editors, apply `classifyByTitles` first and fall back to `PUB_TYPE_MAP`. Update the call in `main()`: editors are assembled before the type is mapped.
- [x] 3.4 Confirm that `mapPubtitle` routes a reclassified ref's `pubtitle` to `bookTitle` with no change, and that `isPubtitleTitle` still applies only to blank-`reftitle` rows.

## 4. Container note (D3)

- [x] 4.1 Add `containerNote(ref)`. For a "book" ref with two titles and no editors it returns `Published in: <pubtitle>[, vol. <pubvol>][, no. <pubno>]` (each part trimmed, blank parts omitted); otherwise null.
- [x] 4.2 In `buildJsonb`, write `comments` as the trimmed source comments, then `; ` and the note when both exist, or whichever one exists alone. Omit `comments` when neither does.

## 5. Logging (D4)

- [x] 5.1 Count and log the refs each title rule reclassifies ("book/book chapter" and "book") and the container notes written, next to the publication-type summary and the pubtitle fallback count.

## 6. Unit tests

- [x] 6.1 Add `migrations/src/tests/refs-transforms.test.js` (`node:test`, so `npm test` runs it). It covers each spec scenario:
  - "book/book chapter" with two titles, pubtitle only, equal titles (including titles that are equal only after trimming), reftitle only, and neither
  - "book" with two titles and editors from the `editors` column, and from `ref_editors`
  - "book" with two titles and no editors
  - an unaffected type ("book chapter", "journal article")
- [x] 6.2 Test the container note: volume and number, title only, volume only, existing comments, and no note on a reclassified chapter or a single-title book.
- [x] 6.3 Check that each reclassified chapter and noted book validates against the reference `db` variant.

## 7. Re-migrate localhost and verify

- [x] 7.1 Run the full migration runner against localhost `pbdb`. All runner assertions pass.
- [x] 7.2 Compare with the baseline from 1.1:
  - The per-step totals are unchanged.
  - The logged rule counts are 3,045, 78 and 236.
  - The publication-type summary moves by exactly 3,123 rows: "edited collection" −3,045, "standalone book" −78, "article in edited collection" +3,123.
  - PBot refs are unchanged.
- [x] 7.3 Spot-check by `legacyIDs.oldpbdbID` that each of these has the expected `publicationType`, `title`, `bookTitle`, `bookType` and `comments`:
  - a "book/book chapter" chapter (e.g. the Robertson Paleocommunities ref)
  - a "book" chapter with editors ("Chapter 7 - Devonian")
  - a noted book with volume and number
  - a noted book with existing comments
  - an equal-titles edited collection
  - a pubtitle-only edited collection
- [x] 7.4 Through the API on localhost: `GET /api/v1/references?bookTitle=…` finds a reclassified chapter, and `?publicationType=edited collection` returns the reduced set.

## 8. Specs, docs and close-out

- [x] 8.1 If the measured counts differ from the spec scenarios, correct the scenarios (and design D4's table) to the measured values.
- [x] 8.2 Check `docs/api-design-backlog.md` "Series and volumes on book-type references" and its "Known data issues" pointer against the measured counts; correct the 236-note figure if it changed.
- [x] 8.3 Record that Aurora `pbdb2_migration_test` still has the old mapping and is rebuilt at the next scheduled rebuild.
- [x] 8.4 Rollback check: reverting the commit and re-running the runner reproduces the baseline from 1.1. Written down as the procedure, not run.

## Notes

- **Measured (2026-11-10, localhost `pbdb`):**
  - Rule counts are 3,045 / 78 / 236, matching the spec scenarios. No scenario needed correcting.
  - Every runner table total equals the baseline, and the refs permids are identical.
  - The PBDB refs diff against the baseline is exactly 3,045 rows (type + `bookTitle`), 78 (type + `bookTitle`, `bookType` removed) and 236 (`comments`); there are no other changes.
  - `comments` count +209: 236 notes, 27 of them appended to existing comments.
  - The API returns 666 `edited collection` refs (665 PBDB + 1 PBot).
- **Aurora:** `pbdb2_migration_test` still has the old mapping (every `book/book chapter` → `edited collection`, no container notes). It is rebuilt with this mapping at the next scheduled rebuild; the procedure is unchanged.
- **Rollback:** revert the implementation commit, drop and recreate `pbdb`, and run `node src/run-migrations.js --createdb`. The refs payloads, table totals and permids then match the 1.1 baseline: PBDB `edited collection` 3,710, `article in edited collection` 2,573, `standalone book` 2,450, no "Published in:" notes. Not run.
- **Runner note (outside this change):** the re-run first stopped at `pbot-persons` because `.env` `PBOT_TOKEN` had a leading `Bearer ` (the script adds it), and then at `pbot-schemas`. The refreshed token (issued 2026-11-03) is for Douglas's own PBot account, which can also see his private test records. Two of those are schemas, "Schema-ddm-09-12a" and "-b" (created 2022-09-12; anonymous requests and earlier runs see only 8 schemas). Their primary reference "Ref-ddm-08-25a" (`de299345…`, also private) carries `pbdbid` 68934, so `pbot-refs` skips it and `pbot-schemas`, which resolves references by `pbotID` only, drops both schemas. Steps from `authorities` on were completed with `--from authorities`, and the schemas/characters/states inserted match the baseline (8/336/1,325).
