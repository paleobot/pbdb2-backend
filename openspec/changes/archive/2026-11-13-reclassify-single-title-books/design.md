## Context

`migrate-refs.js` maps Classic `publication_type` through `PUB_TYPE_MAP`. Since `fix-book-chapter-migration`, `classifyByTitles()` applies first: a `book/book chapter` ref with two distinct titles (`hasTwoTitles()`) becomes `article in edited collection`. Every other `book/book chapter` ref falls through to the table row `{ referenceType: 'edited collection', bookType: null }`, and that row is what this change replaces. The proposal covers why: 665 refs, almost all authored books.

What already works for a `standalone book`, so the 665 need no new handling:
- **Title:** `mapTitle()` takes `pubtitle` when `reftitle` is blank, for every type in `PUBTITLE_TITLE_TYPES` (`standalone book`, `edited collection`).
- **Editors:** `buildJsonb()` writes `editors` whatever the type. The db variant applies no per-type field rule, so `editors` on a `standalone book` validates, as on Classic `book` refs today.
- **`pubtitle`:** `mapPubtitle()` has no destination for `standalone book` and `edited collection` alike. A single-title ref's `pubtitle` either is its title or equals its `reftitle`.
- **Volume and number:** `mapVolNo()` maps them only for `journal article` and `serial monograph`. The ~49 refs with a `pubvol` lose it today as `edited collection` and will lose it the same way as `standalone book`. This is not new loss.

Classic has no way to mark a ref as an edited volume, and that holds for refs still being added (explored 2026-11-13, `pbdb_2026_10_18`):
- **No such type.** The `publication_type` enum has `book`, `book chapter` and `book/book chapter`, and nothing for an edited volume.
- **`book/book chapter` is out of use.** The last one was created on 2024-08-23, and none in 2025 or 2026, out of about 5,000 refs a year. The last single-title one was created in 2023. Most of the 665 were entered between 2009 and 2013.
- **New edited volumes arrive as `book` with editors,** for example ref 72964, Swingland & Klemens, *The Conservation Biology of Tortoises*, entered in 2020. That route already maps to `standalone book`, and this change does not touch it. There are about 35 single-title `book` refs with editors.
- **No rule separates them.** The best candidate tested, single-title `book` or `book/book chapter` refs whose author surnames all appear in `editors`, matches 12 refs. About 4 are edited volumes (Swingland & Klemens; Thanh & Khuc, *Stratigraphic units of Vietnam*; Ziegler, *Catalogue of Conodonts*; probably Clark 1911). The rest are single authors who also entered themselves as editor, revisers of a later edition (Pritchard 1861), or a chapter missing its title (Martin, editors "Martin and Barnosky"). Classic also uses `editors` for series editors (Sues on *Handbook of Paleoherpetology*) and publishers (Reimer on Haeckel).

So whatever this change maps to, an edited volume stored in Classic, now or later, cannot be recognised when migrated. Curators fix such refs in pbdb2 afterwards, by changing `publicationType`. The review list is how they find them, so it covers both routes (D3–D5).

The review list is new output. The proposal asks for one row per suspect ref, regenerated on each re-migration, for a curator to read. Two existing conventions bear on it:
- `migration-script-layout` requires a migration's run artifacts to sit in its own directory.
- The run artifacts that exist (`anomalies.csv`, `run-summary.txt`) are gitignored.

## Goals / Non-Goals

**Goals:**
- Classic `book/book chapter` refs without two distinct titles migrate as `standalone book` with `bookType` `"monograph"`.
- Every reclassified ref that matches a warning sign is listed with enough context for a curator to judge it without opening the API: who, when, what title, and which signs matched.
- Every single-title Classic `book` ref with editors is listed too, so edited volumes entered in Classic after this change show up in the list's diff on the next re-migration.
- A re-run on unchanged source data leaves the review list byte-identical, so `git diff` shows only real changes.
- Every other runner count reproduces exactly.

**Non-Goals:**
- Acting on any warning sign. No ref is reclassified by heuristic (see the proposal).
- A migration rule that maps any Classic ref to `edited collection`. None separates edited volumes from authored books (see Context). If Classic curators later agree on a way to mark one, the rule is written then.
- Recovering `pubvol` or `pubno` for books, or a missing chapter title.
- Changing the PBot refs migration, the payload schema, the API or the DDL.
- Reviewing misfiled refs of other Classic types. The proposal's evidence shows misfiling in every type. This list covers the 665, plus single-title `book` refs with editors, because edited volumes arrive by that route.

## Decisions

### 1. Change the table row; leave the title rule alone

`PUB_TYPE_MAP['book/book chapter']` becomes `{ referenceType: 'standalone book', bookType: 'monograph' }`, the same target as `book`. `classifyByTitles()` is unchanged and still runs first, so the 3,045 two-title refs remain chapters.

*Alternative:* a third branch in `classifyByTitles()` that returns `standalone book` for one-title refs. Rejected: the table already states the default for a type, and the title rule is the exception. Keeping it that way leaves the spec's table and the code saying the same thing.

### 2. Keep `edited collection` in `PUBTITLE_TITLE_TYPES`

The set stays `standalone book` and `edited collection`. It lists the target types that are whole books, which Classic may store with the title in `pubtitle` alone. It is not a list of the types some Classic row maps to. `edited collection` is a whole book whether or not anything maps to it today. Only the comment changes, to say that.

If the entry were dropped, a later rule mapping to `edited collection` (see Non-Goals) would leave those refs with no title unless whoever writes the rule remembers to put it back.

*Alternative:* drop the entry as dead code under build-for-now. Rejected (2026-11-13): the set states a fact about the target types. Removing a true fact to save one set entry creates a trap for the next rule.

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
reference_no,permid,classic_type,authors,editors,year,title,pages,signals
```

- **`classic_type`:** the Classic `publication_type`, `book/book chapter` or `book`. It tells the two groups apart.
- **`authors`:** family names in order, joined by `; `.
- **`editors`:** the migrated `editors` string, blank when there is none.
- **`year`:** the migrated `publicationYear`.
- **`title`:** the migrated `title`, blank when there is none.
- **`pages`:** `first–last` from the migrated pages, or the raw `firstpage`/`lastpage` when they are not numeric.
- **`signals`:** every matching sign's name (below), joined by `; `, in a fixed order.
- **Which rows:** refs in the review group that match at least one sign. The group is:
  - every reclassified ref (Classic `book/book chapter` without two titles);
  - every Classic `book` ref without two titles that has editors (the spec's *has editors*). Each one matches `book-with-editors`, so all of them are listed.

  Rows are sorted by `reference_no`.
- **Format:** UTF-8, one header line, fields quoted as in the anomaly ledger (quoted only when they contain `"`, `,` or a newline). No timestamp or run metadata, so an unchanged source gives an identical file.

### 5. The seven signs

Computed by an exported pure function, so `refs-transforms.test.js` can test each sign without a database. Its inputs are the source ref, its migrated payload, and two sets built in `main()` after transforming every row: the trimmed, lowercased `bookTitle` of every ref that migrated as `article in edited collection`, and the `journalTitle` of every `journal article`. It returns no signs for a ref outside the review group (D4). Every sign applies to both groups, except that `multi-author-no-editors` never matches a `book` ref in the group and `book-with-editors` matches only those.

| Name | Matches when | Est. | Measured: `book/book chapter` | Measured: `book` |
|---|---|---:|---:|---:|
| `chapter-missing-title` | editors present, and the title is blank or starts with `in ` or `in:` (ignoring case) | 16 | 16 | 0 |
| `multi-author-no-editors` | two or more authors and no editors | 149 | 149 | 0 |
| `pubtitle-is-book-title` | trimmed, lowercased `pubtitle` is in the book-title set | 36 | 36 | 0 |
| `pubtitle-is-journal-title` | trimmed, lowercased `pubtitle` is in the journal-title set | 15 | 15 | 0 |
| `first-page-after-1` | numeric `firstpage` greater than 1 | 60 | 63 | 9 |
| `edited-volume-words` | the title matches proceedings, symposium, congress, conference, festschrift or "in honour/honor", or the title or `comments` contains the word `ed.`, `eds.`, `editor`, `editors` or `edited` | 16 | 16 | 1 |
| `book-with-editors` | the ref is a Classic `book` without two titles and has editors | ~35 | — | 35 |
| **any sign (rows)** | | **~272** | **240** | **35** |

The estimates come from SQL over `pbdb_2026_10_18` (2026-11-13). Three of them approximated the migration's logic: the book-title set used Classic types rather than mapped ones, "two or more authors" used `author2last`, and `book-with-editors` used the `editors` column without `ref_editors`. The measured counts come from the localhost run of 2026-11-13: 275 rows, of which 48 reclassified refs match two or more signs. `first-page-after-1` measures 63 rather than 60 because the migration parses page numbers like `buildPages()`, which also reads a leading number such as `97a`.

Six of the 17 `edited-volume-words` rows match only because "ed." abbreviates an edition ("2nd ed.", "1st ed."). That is a known source of false positives, left in because the list is read by a person.

`book-with-editors` lists the whole group rather than testing it, because no test separates edited volumes there (see Context). With about 35 rows it is small enough to read in full, and each new `book` with editors from a later dump adds a row to the diff.

The proposal's "~30" chapters missing a title counted chapters without editors, such as "in Bering Land Bridge", which carry `multi-author-no-editors` here. `chapter-missing-title` requires editors and is the high-precision sign.

### 6. Run summary

The summary gains two lines: the count of `book/book chapter` refs mapped to `standalone book` because they lack two titles (665), and the review-list row count, split by `classic_type`, with a count for each sign. The existing "Titles taken from pubtitle" count is unchanged: the same refs take the same title under a different type.

## Risks / Trade-offs

- **The ~20–50 real edited volumes lose a correct label.** Accepted in the proposal. They are the refs most likely to carry `multi-author-no-editors` or `pubtitle-is-book-title`, so the review list is where a curator finds them.
- **Edited volumes added to Classic before it retires migrate as `standalone book`.** They arrive as `book`, which already maps there, and this change neither causes nor fixes that. `book-with-editors` puts each one in the review list. An edited volume entered with the editors only as authors, and nothing in `editors`, matches no sign at all. Classic stores nothing that would catch it.
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

Rollback: revert the implementation commit, drop and recreate `pbdb`, and run `node src/run-migrations.js --createdb`. This reproduces the baseline, and the review CSV goes away with the revert. No schema state is involved.

Aurora `pbdb2_migration_test` keeps the old mapping (665 `edited collection` refs, no review list) until its next scheduled rebuild.

## Open Questions

- **Does Classic's entry form still offer `book/book chapter`?** Not blocking: the design holds either way. If the form no longer offers it, no future ref can take that route, and only `book-with-editors` watches for new edited volumes. To ask the Classic maintainers.
