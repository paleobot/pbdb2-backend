## 1. Baseline

- [ ] 1.1 Record the current localhost totals before changing anything:
  - the runner's per-step counts and assertions from the last full run
  - the refs publication-type summary of head rows (`SELECT reference->>'publicationType', count(*) FROM refs WHERE succeeded_by_id IS NULL GROUP BY 1`), split by `legacyIDs.oldpbdbID` vs `legacyIDs.pbotID`
  - a dump of the PBDB refs payloads (`id`, `permid`, `reference`) for the diff in 6.2
- [ ] 1.2 Confirm the source counts the specs assert against `pbdb_2026_10_18`:
  - 665 "book/book chapter" refs without two titles (618 `pubtitle` only, 16 equal, 15 `reftitle` only, 16 neither)
  - the unchanged 3,045 / 78 / 236 title-rule counts
  - about 35 "book" refs without two titles that have editors, counting `ref_editors` as well as the `editors` column (the `book-with-editors` group; design D5)

  If any count differs, stop and reconcile the proposal and specs first.

## 2. Mapping (design D1, D2)

- [ ] 2.1 In `migrations/src/refs-migration/migrate-refs.js`, change `PUB_TYPE_MAP['book/book chapter']` to `{ referenceType: 'standalone book', bookType: 'monograph' }`. `classifyByTitles()` is unchanged.
- [ ] 2.2 Leave the entries of `PUBTITLE_TITLE_TYPES` (`standalone book`, `edited collection`) unchanged. Rewrite its comment to say it lists the target types that are whole books, which Classic may store with the title in `pubtitle` alone, and that `edited collection` stays although no Classic row maps to it.
- [ ] 2.3 Count the "book/book chapter" refs mapped to "standalone book" for lacking two titles, and log the count beside the title-rule counts (spec: Migration logging).

## 3. Review list (design D3–D5)

- [ ] 3.1 Add an exported pure function that returns a ref's matching signal names in spec order. Its inputs are the source ref, its built jsonb, its assembled editors, and the book-title and journal-title sets. It returns none for a ref outside the review group:
  - "book/book chapter" refs without two titles
  - "book" refs without two titles that have editors

  It implements the seven signals exactly as the spec's table defines them.
- [ ] 3.2 In `main()`, after transforming every row, build the two sets from the built payloads: the trimmed, lowercased `bookTitle` of refs mapped to "article in edited collection", and the `journalTitle` of refs mapped to "journal article". Keep the source row and jsonb of each ref in the review group for the list.
- [ ] 3.3 After the upsert, write `src/refs-migration/single-title-books-review.csv`, resolved relative to the script:
  - columns and cell formats as in the spec, including `classic_type`
  - rows sorted by `reference_no`, UTF-8, with the quoting rule
  - no timestamp
  - permids taken from `permidById`
- [ ] 3.4 Log the row count split by Classic type, and the count for each signal.
- [ ] 3.5 Confirm the CSV is not matched by `.gitignore`.

## 4. Unit tests (`migrations/src/tests/refs-transforms.test.js`)

- [ ] 4.1 Replace the three "stays an edited collection" tests with the spec's scenarios:
  - pubtitle only and equal titles → "standalone book" / "monograph"
  - reftitle only and neither → "standalone book"
  - one title with editors → "standalone book", with `editors` kept
- [ ] 4.2 Add a title test: a single-title "book/book chapter" ref takes its `title` from `pubtitle`. The existing "Corals of the World" test reaches "edited collection" through a "book/book chapter" row, which now yields "standalone book". Replace it with a test that calls the title mapping directly with the target "edited collection" (export `mapTitle()` for it), so the spec scenario "Edited collection title recovered from pubtitle" stays covered.
- [ ] 4.3 Test:
  - each signal on its own
  - a ref with several signals, with the order checked
  - a plain authored book, which yields none
  - a single-title "book" with editors, which yields `book-with-editors`
  - a single-title "book" without editors, which yields none
  - refs outside the review group, which yield none
- [ ] 4.4 Test the CSV row formatting: quoting of commas, quotes and newlines; non-ASCII text unchanged; numeric and non-numeric pages; blank title and editors.
- [ ] 4.5 Check that reclassified refs, including one with editors and one with no title, validate against the reference `db` variant.
- [ ] 4.6 Run `npm test` at the repository root. Everything passes.

## 5. Re-migrate localhost

- [ ] 5.1 Run the full migration runner against localhost `pbdb`. All runner assertions pass.
- [ ] 5.2 Run the refs step a second time on the rebuilt database and confirm `single-title-books-review.csv` is byte-identical (spec scenario "Unchanged source rewrites an identical file"). Then rebuild once more with the full runner, so localhost is not left with a refs-only re-run.

## 6. Verify

- [ ] 6.1 Compare with the 1.1 baseline:
  - The per-step totals and the refs permids are unchanged.
  - Head-row publication types move by exactly 665: "edited collection" 666 → 1 (the PBot test ref `REF-1000036-88`), "standalone book" 2,393 → 3,058.
  - The logged counts are 665 reclassified, plus the unchanged 3,045 / 78 / 236.
  - "Titles taken from pubtitle" is unchanged.
- [ ] 6.2 Diff the PBDB refs payloads against the 1.1 dump. Exactly 665 rows differ, each only in `publicationType` ("edited collection" → "standalone book") and an added `bookType: "monograph"`.
- [ ] 6.3 Spot-check by `legacyIDs.oldpbdbID`:
  - Gould, *The Panda's Thumb* (pubtitle only)
  - an equal-titles ref
  - REF-3343-11 (no title, editors Biggs)
  - Fraser & Sues (listed with `multi-author-no-editors`)
- [ ] 6.4 Read the review list:
  - The row count is near the ~272 estimate: about 237 "book/book chapter" rows and about 35 "book" rows.
  - The seven per-signal counts are near the design D5 estimates.
  - Swingland & Klemens, *The Conservation Biology of Tortoises* (ref 72964), is listed with `classic_type` "book" and `book-with-editors`.
  - The known examples carry the expected signals (REF-3343-11 `chapter-missing-title`; Bronn 1848 `pubtitle-is-journal-title`; Martill & Bechly, Crato, `pubtitle-is-book-title`; an Agassiz instalment `first-page-after-1`).
- [ ] 6.5 Through the API on localhost: `GET /api/v1/references?publicationType=edited%20collection` returns only the PBot ref, and `?publicationType=standalone%20book` returns 3,058.

## 7. Specs, docs and close-out

- [ ] 7.1 If the measured counts differ from the spec scenarios, the proposal or design D5, correct them to the measured values.
- [ ] 7.2 Add a "Known data issues that affect the API" entry to `docs/api-design-backlog.md`: the misclassified refs among the reclassified books (edited volumes stored as authored books, chapters missing their title), and edited volumes entered in Classic as "book", which also migrate as "standalone book". Curators fix both in pbdb2 by changing `publicationType`. Point to `migrations/src/refs-migration/single-title-books-review.csv`.
- [ ] 7.3 In `add-ris-reference-output/design.md`, settle the `EDBOOK`-vs-`BOOK` open question: `edited collection` now holds only PBot refs and new references, so it keeps `EDBOOK`. Update the ~665 mention in its Context.
- [ ] 7.4 Record that Aurora `pbdb2_migration_test` still has the old mapping and is rebuilt at the next scheduled rebuild.
- [ ] 7.5 Rollback, written down rather than run: revert the implementation commit, drop and recreate `pbdb`, and run `node src/run-migrations.js --createdb`. This reproduces the 1.1 baseline, and the review CSV is removed with the revert.
