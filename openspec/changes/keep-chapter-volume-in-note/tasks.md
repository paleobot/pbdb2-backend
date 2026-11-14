## 1. Baseline

- [ ] 1.1 Dump the current localhost `refs.reference` payloads, permid and jsonb ordered by permid, to a scratch file. Record every runner step total from the last full run as the comparison baseline.

## 2. Migration code

- [ ] 2.1 In `migrations/src/refs-migration/migrate-refs.js`, give `containerNote(ref, editors, referenceTypeName)` the chapter case (design D1, D4): `referenceTypeName === 'article in edited collection'` and a non-blank trimmed `pubvol` or `pubno`. Keep the book case unchanged.
- [ ] 2.2 Build the note from optional parts (D3): the trimmed `pubtitle` when non-blank, then `vol. …`, then `no. …`, joined with `, ` after `Published in: `. The book case's output must not change.
- [ ] 2.3 Update the comment above `containerNote` to describe both cases.
- [ ] 2.4 In `main()`, pass `pubType.referenceTypeName` to `containerNote`, and replace `containerNoteCount` with book and chapter counts (D5). Log both in place of `Container notes written to comments: N`.

## 3. Tests

- [ ] 3.1 In `migrations/src/tests/refs-transforms.test.js`, make the `migrate()` helper pass the target type to `containerNote`. The existing book-note tests must pass unchanged.
- [ ] 3.2 Replace the `row({ reftitle: 'Part', pubtitle: 'Whole', pubvol: '3' })` assertion in "no note on a reclassified chapter or a single-title book": a chapter with a volume now gets a note. Keep the assertions for a two-title book with editors and no volume, and for a single-title book.
- [ ] 3.3 Add chapter tests, one per spec scenario:
  - volume only, keeping `bookTitle` as the whole `pubtitle`
  - number only
  - volume and number, with values trimmed
  - follows existing comments
  - no `pubtitle` (`Published in: vol. 3, no. 2`, no `bookTitle`)
  - a chapter by each title rule ("book/book chapter" with two titles; "book" with two titles and editors)
  - no volume or number gives no note
  - a journal article, serial monograph and single-title standalone book with `pubvol` get no note
- [ ] 3.4 Add a chapter with a volume and a chapter with no `pubtitle` to the db-variant validation cases.
- [ ] 3.5 Run `npm test` from the repository root; all suites pass.

## 4. Re-migration and verification

- [ ] 4.1 Drop and recreate localhost `pbdb`, and run the full runner (`node src/run-migrations.js --createdb` from `migrations/`). The refs step logs book notes = 236 and chapter notes ≈ 1,907.
- [ ] 4.2 Every runner step total and every ref permid matches the baseline.
- [ ] 4.3 Diff the payloads against the baseline:
  - only `comments` differs
  - only on refs whose `publicationType` is `article in edited collection`
  - the number of differing refs equals the chapter-note count
  - every differing `comments` ends with the new note, after the old value and `; ` when there was one
- [ ] 4.4 Spot-check, in the database or through the API:
  - ref 9726 (volume only)
  - a chapter with volume and number
  - a chapter with existing comments
  - all six chapters with no `pubtitle` (2196, 44753, 79623, 86168, 87648, 88142)
  - a chapter with no volume, which has no note
  - a two-title book with no editors, whose note is unchanged

## 5. Docs and wrap-up

- [ ] 5.1 Confirm the `docs/api-design-backlog.md` entries ("Series and volumes on book-type references", "Volume and number dropped on book-type refs") match the measured counts; adjust any number that differs.
- [ ] 5.2 Rollback check: the change is code only, so reverting the commit and rebuilding restores the baseline. Note this in the commit message if verification found nothing to fix.
