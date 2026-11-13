## Context

`migrate-refs.js` maps Classic `publication_type` through `PUB_TYPE_MAP`. Since `fix-book-chapter-migration`, `classifyByTitles()` applies first: a `book/book chapter` ref with two distinct titles (`hasTwoTitles()`) becomes `article in edited collection`. Every other `book/book chapter` ref falls through to the table row `{ referenceType: 'edited collection', bookType: null }`, and that row is what this change replaces. The proposal covers why: 665 refs, almost all authored books.

What already works for a `standalone book`, so the 665 need no new handling:
- **Title:** `mapTitle()` takes `pubtitle` when `reftitle` is blank, for every type in `PUBTITLE_TITLE_TYPES` (`standalone book`, `edited collection`).
- **Editors:** `buildJsonb()` writes `editors` whatever the type. The db variant applies no per-type field rule, so `editors` on a `standalone book` validates, as on Classic `book` refs today.
- **`pubtitle`:** `mapPubtitle()` has no destination for `standalone book` and `edited collection` alike. A single-title ref's `pubtitle` either is its title or equals its `reftitle`.
- **Volume and number:** `mapVolNo()` maps them only for `journal article` and `serial monograph`. The ~49 refs with a `pubvol` lose it today as `edited collection` and will lose it the same way as `standalone book`. This is not new loss.

The review list is new output. The proposal asks for one row per suspect ref, regenerated on each re-migration, for a curator to read. Two existing conventions bear on it:
- `migration-script-layout` requires a migration's run artifacts to sit in its own directory.
- The run artifacts that exist (`anomalies.csv`, `run-summary.txt`) are gitignored.

## Goals / Non-Goals

**Goals:**
- Classic `book/book chapter` refs without two distinct titles migrate as `standalone book` with `bookType` `"monograph"`.
- Every reclassified ref that matches a warning sign is listed with enough context for a curator to judge it without opening the API: who, when, what title, and which signs matched.
- A re-run on unchanged source data leaves the review list byte-identical, so `git diff` shows only real changes.
- Every other runner count reproduces exactly.

**Non-Goals:**
- Acting on any warning sign. No ref is reclassified by heuristic (see the proposal).
- Recovering `pubvol` or `pubno` for books, or a missing chapter title.
- Changing the PBot refs migration, the payload schema, the API or the DDL.
- Reviewing misfiled refs of other Classic types. The proposal's evidence shows misfiling in every type; this list covers only the 665.

## Decisions

### 1. Change the table row; leave the title rule alone

`PUB_TYPE_MAP['book/book chapter']` becomes `{ referenceType: 'standalone book', bookType: 'monograph' }`, the same target as `book`. `classifyByTitles()` is unchanged and still runs first, so the 3,045 two-title refs remain chapters.

*Alternative:* a third branch in `classifyByTitles()` that returns `standalone book` for one-title refs. Rejected: the table already states the default for a type, and the title rule is the exception. Keeping it that way leaves the spec's table and the code saying the same thing.

### 2. Drop `edited collection` from `PUBTITLE_TITLE_TYPES`

No Classic ref maps to `edited collection` any more, so that entry would be dead code. The set becomes `standalone book` alone, and its comment says a whole book is the one case where Classic keeps the title in `pubtitle`.

*Alternative:* keep the entry in case a future mapping targets `edited collection`. Rejected under build-for-now; the next mapping that needs it can add it back.

### 3. The review list is written by the refs migration, beside it, and committed

`migrate-refs.js` writes `migrations/src/refs-migration/single-title-books-review.csv` on every run, after the upsert, and the file is **not** gitignored.

- **Written by the migration:** the migration already holds every ref, its authors and editors, and every other ref's mapped `bookTitle` and `journalTitle`, which two of the signs compare against. A separate script would re-read MariaDB and re-implement `hasTwoTitles()` and the type mapping. The user asked for a list regenerated on re-migration, and this is the direct reading.
- **Beside the script:** `migration-script-layout` ("Run artifacts are written beside the producing script") forbids writing elsewhere, `docs/` included. The proposal's `docs/` path is changed to match.
- **Committed:** unlike `anomalies.csv`, this file is the record that curators work from. Committing it makes every re-migration's effect visible as a diff. It goes away when `migrations/` retires, by which time its findings should be curated into pbdb2 itself.
- **After the upsert:** each row carries the ref's permid, so a curator can open `/api/v1/references/<permid>`. Permids are `REF-<reference_no>-<CC>` and are known once the batch has registered them (`permidById`).

*Alternatives considered:*
- `docs/` path. Rejected: it needs a layout-spec amendment for a single file.
- Rows in `anomalies.csv` through `createAnomalyLog()`. Rejected: that file is gitignored, and its fixed columns (`issue`, `description`) would pack the context into free text.
- A standalone report script. Rejected for the duplication described above.

### 4. Columns and row rules

```
reference_no,permid,authors,editors,year,title,pages,signals
```

- **`authors`:** family names in order, joined by `; `.
- **`editors`:** the migrated `editors` string, blank when there is none.
- **`year`:** the migrated `publicationYear`.
- **`title`:** the migrated `title`, blank when there is none.
- **`pages`:** `first–last` from the migrated pages, or the raw `firstpage`/`lastpage` when they are not numeric.
- **`signals`:** every matching sign's name (below), joined by `; `, in a fixed order.
- **Which rows:** only reclassified refs (Classic `book/book chapter` without two titles) with at least one sign. Rows are sorted by `reference_no`.
- **Format:** UTF-8, one header line, fields quoted as in the anomaly ledger (quoted only when they contain `"`, `,` or a newline). No timestamp or run metadata, so an unchanged source gives an identical file.

### 5. The six signs

Computed by an exported pure function, so `refs-transforms.test.js` can test each sign without a database. Its inputs are the source ref, its migrated payload, and two sets built in `main()` after transforming every row: the trimmed, lowercased `bookTitle` of every ref that migrated as `article in edited collection`, and the `journalTitle` of every `journal article`.

| Name | Matches when | Est. refs |
|---|---|---:|
| `chapter-missing-title` | editors present, and the title is blank or starts with `in ` or `in:` (ignoring case) | 16 |
| `multi-author-no-editors` | two or more authors and no editors | 149 |
| `pubtitle-is-book-title` | trimmed, lowercased `pubtitle` is in the book-title set | 36 |
| `pubtitle-is-journal-title` | trimmed, lowercased `pubtitle` is in the journal-title set | 15 |
| `first-page-after-1` | numeric `firstpage` greater than 1 | 60 |
| `edited-volume-words` | the title matches proceedings, symposium, congress, conference, festschrift or "in honour/honor", or the title or `comments` contains the word `ed.`, `eds.`, `editor`, `editors` or `edited` | 16 |
| **any sign** | | **~237** |

The estimates come from SQL over `pbdb_2026_10_18` (2026-11-13). Two of them approximate the migration's logic: the book-title set used Classic types rather than mapped ones, and "two or more authors" used `author2last`. The run reports the exact counts. About 48 refs match two or more signs.

The proposal's "~30" chapters missing a title counted chapters without editors, such as "in Bering Land Bridge", which carry `multi-author-no-editors` here. `chapter-missing-title` requires editors and is the high-precision sign.

### 6. Run summary

The summary gains two lines: the count of `book/book chapter` refs mapped to `standalone book` because they lack two titles (665), and the review-list row count, with a count for each sign. The existing "Titles taken from pubtitle" count is unchanged: the same refs take the same title under a different type.

## Risks / Trade-offs

- **The ~20–50 real edited volumes lose a correct label.** Accepted in the proposal. They are the refs most likely to carry `multi-author-no-editors` or `pubtitle-is-book-title`, so the review list is where a curator finds them.
- **The list is mostly false positives.** Each sign alone was about 50% precise in the exploration. The list is a reading aid, its header names each sign, and the change's specs describe it as unverified.
- **A committed file that the migration rewrites can dirty the working tree,** for example after a localhost re-run against a newer dump. The diff is the point. The cost is a commit after any re-migration that changes it, which is the same discipline as the runner's recorded totals.
- **Non-ASCII names and titles** (d'Orbigny, Chlupáč, Russian transliterations) must survive. The file is written as UTF-8, and the quoting rule covers commas in titles.
- **The 1 PBot test ref (`REF-1000036-88`) stays `edited collection`.** It comes from the PBot refs migration, which this change doesn't touch.

## Migration Plan

1. Implement the code changes and unit tests, then run `npm test`.
2. Re-run the full runner on localhost and check:
   - `refs` head rows unchanged: 96,122.
   - `edited collection` heads: 666 → 1 (the PBot test ref).
   - `standalone book`: 2,393 → 3,058.
   - Every other step's totals reproduce exactly.
   - The review-list row count matches the summary.
3. Read through the review list once, to confirm the signs fire as described.
4. Commit the code, the spec deltas and the review list. Aurora `pbdb2_migration_test` is rebuilt later, as the proposal says.

Rollback: revert the commit and re-run the runner. No schema state is involved.

## Open Questions

None.
