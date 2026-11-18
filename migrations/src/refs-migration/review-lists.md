# Refs migration review lists

The refs migration moves about 96,000 PBDB Classic references into pbdb2. Most of them map to a pbdb2 publication type cleanly. Two groups don't, because Classic never recorded what pbdb2 needs to know:

- **Single-title books.** Classic has no "edited volume" type, so an edited volume and an authored book look the same.
- **Untyped refs.** 1,183 refs have no publication type at all.

The script types both groups as best the data allows, and it never guesses where the evidence is weak. Every run, it writes a CSV of each group beside itself, so that a curator can check the result and correct what's wrong:

| File | Rows | What it lists |
|---|---:|---|
| [`single-title-books-review.csv`](single-title-books-review.csv) | 275 | Refs migrated as `standalone book` that may really be an edited volume or a chapter |
| [`untyped-refs-review.csv`](untyped-refs-review.csv) | 1,183 | Every Classic ref with no publication type, and the type it got |

*The counts are from Classic dump `pbdb_2026_10_18`. The rules are specified in `openspec/specs/refs-migration/spec.md`, under "Review list of suspect single-title books" and "Review list of untyped refs".*

## Before you start

- **The lists are reading aids, not verdicts.** Nothing in them has been checked by hand. A listed ref may be correct as migrated. Read the ref, decide, and leave it alone if it's right.
- **They are regenerated on every run.** Both files are rewritten from the Classic data each time the migration runs, with the same rows in the same order, sorted by `reference_no`. Don't edit them. To track your progress, copy one first, or keep notes keyed by `reference_no` or `permid`.
- **Where to make a correction:**
  - **In Classic, while it is still the source.** The migration rewrites every ref from Classic on each run, so a correction made in Classic is kept, and the ref drops off the list once it no longer qualifies. Setting `publication_type` on an untyped ref, or filling in a chapter's `reftitle`, are both Classic fixes.
  - **In pbdb2, after the last Classic migration.** A correction made in pbdb2 earlier would be overwritten by the next run.
- **Columns use pbdb2 values** (the migrated title, authors and type), except where a column is named after a Classic field (`classic_type`, `pubtitle`, `pubvol`, `pubno`).

## `single-title-books-review.csv`

### Why these refs are listed

Classic's "book/book chapter" and "book" types held whole books and chapters alike. The migration tells them apart by their titles:
- a ref with **two different titles** (`reftitle` and `pubtitle`) is a chapter in a book;
- a ref with **one title** is a whole book, and migrates as `standalone book` with `bookType` `monograph`.

That's right for most refs, but a single title also describes two kinds of ref that aren't authored books:
- **An edited volume** whose editors were entered as its authors. Classic has no edited-volume type, so no Classic ref migrates as `edited collection`.
- **A chapter whose chapter title was never entered**, so only the book's title is left.

The list holds the refs in this group that show at least one sign of being one of these:
- every single-title "book/book chapter" ref that shows any signal (240);
- every single-title "book" ref with editors (35). This is how Classic curators enter edited volumes, so every one is listed.

### Columns

| Column | Meaning |
|---|---|
| `reference_no` | Classic `reference_no` |
| `permid` | pbdb2 permid (`REF-…`) |
| `classic_type` | `book/book chapter` or `book` |
| `authors` | Family names, in order, separated by `; ` |
| `editors` | The editors text, if any |
| `year` | Publication year |
| `title` | The migrated title. It is blank when Classic had neither title. |
| `pages` | `first–last` |
| `signals` | Every signal the ref matches, separated by `; ` (below) |

### Signals

| Signal | Rows | What it suggests |
|---|---:|---|
| `chapter-missing-title` | 16 | Editors are present, and the title is blank or starts with "in …". Probably **a chapter** whose own title is missing. |
| `multi-author-no-editors` | 149 | Two or more authors and no editors. Possibly **an edited volume** with its editors entered as authors. Many are simply co-authored books. |
| `pubtitle-is-book-title` | 36 | Other refs cite this title as their book. The ref is that book, so possibly **an edited volume**. |
| `pubtitle-is-journal-title` | 15 | Other refs cite this title as their journal. Possibly a journal issue or a mis-typed article. |
| `first-page-after-1` | 72 | The pages start after page 1. Probably **a chapter**, since a whole book starts at 1. |
| `edited-volume-words` | 17 | The title says "proceedings", "symposium", "congress", "conference", "festschrift" or "in honour", or the title or comments mention editors. Possibly **an edited volume**. |
| `book-with-editors` | 35 | A Classic "book" with editors: the route by which edited volumes were entered. |

Several signals together are stronger evidence than one. `first-page-after-1` together with `chapter-missing-title` is almost certainly a chapter, for example ref 1300, pages 83–96, editor K. M. Stewart, no title.

### What to do with each row

Look the ref up (Classic, or pbdb2 by `permid`) and decide which it is:

| It is… | Correct it to |
|---|---|
| **An authored book** | Nothing to do. This is the most common outcome. |
| **An edited volume** | `publicationType` `edited collection`. Move the people listed as authors into `editors`, and keep `publisher` and `pages`. |
| **A chapter** | `publicationType` `article in edited collection`. Put the chapter's own title in `title`, the book's title in `bookTitle`, and the book's editors in `editors`. If you can't find the chapter title, leave the ref as it is and note it. |
| **A volume in a series** | `publicationType` `serial monograph`, with the series in `seriesTitle` and the volume in `seriesVolume` (and `seriesNumber` if there is one). |

In Classic, the matching fixes are:
- **an edited volume:** none. Classic has no edited-volume type, so this can only be corrected in pbdb2;
- **a chapter:** fill in `reftitle`. A "book/book chapter" ref with two titles migrates as a chapter;
- **a volume in a series:** set `publication_type` to "serial monograph".

## `untyped-refs-review.csv`

### Why these refs are listed

1,183 Classic refs have no `publication_type`. All were entered between 1999 and 2005, 827 of them in 2002, which looks like a bulk import. Most are ordinary journal articles (*Nature*, *C. R. Acad. Sci. Paris*), but nothing on the ref says so.

The migration decides by how the rest of Classic uses the ref's `pubtitle`:
- If **more than half** of the typed Classic refs with the same `pubtitle` (ignoring case) are journal articles, the untyped ref migrates as a **`journal article`**: `pubtitle` → `journalTitle`, `pubvol` → `journalVolume`, `pubno` → `journalNumber`.
- Otherwise it migrates as **`other`**. Its `pubtitle`, volume and number are kept in `comments` as a note, for example `Published in: Geologisches Jahrbuch, Beihefte, vol. 85`.

Every untyped ref is listed, whichever type it got.

### Columns

| Column | Meaning |
|---|---|
| `reference_no` | Classic `reference_no` |
| `permid` | pbdb2 permid (`REF-…`) |
| `type` | The type it migrated as: `journal article` or `other` |
| `journal_share` | `journal/typed`: how many typed Classic refs with the same `pubtitle` are journal articles, out of how many typed refs have it. Blank when no typed ref has the `pubtitle`. |
| `authors` | Family names, in order, separated by `; ` |
| `year`, `title` | As migrated |
| `pubtitle`, `pubvol`, `pubno` | The Classic values, trimmed |

### Reading `journal_share`

The share tells you how strong the evidence behind the migrated type is:

| Rows | Type | Share | How much to trust it |
|---:|---|---|---|
| 100 | journal article | only one or two journal refs behind it (`1/1`, `2/3`) | **Weak. Check these first.** One mis-typed Classic ref can carry them. *Fossil Vertebrates of Africa* (a book series) is one. |
| 344 | journal article | three or more, all journal articles (`96/96`) | Strong. A quick look is enough. |
| 214 | journal article | three or more, mostly journal articles (`618/619`) | Good. Look at the ones near half. |
| 48 | other | a minority, e.g. `153/336` for *USGS Professional Paper* | The title is mostly a series or book in Classic, so `other` was the cautious choice. Most are really serial monographs or chapters. |
| 477 | other | blank | No typed Classic ref has the title, so there was no evidence either way. This is the biggest job. Many are journal articles in journals PBDB has no other refs for. |

### What to do with each row

| It is… | Correct it to |
|---|---|
| **A journal article**, typed `journal article` | Nothing to do. |
| **A journal article**, typed `other` | `publicationType` `journal article`. Move the journal, volume and number from the `Published in: …` note into `journalTitle`, `journalVolume` and `journalNumber`, and remove the note. |
| **A volume in a series** (a Bulletin, Memoir, Professional Paper) | `publicationType` `serial monograph`, with `seriesTitle`, `seriesVolume` and `seriesNumber`. If it was typed `journal article`, move the three journal fields across. |
| **A chapter in a book** | `publicationType` `article in edited collection`, with the book in `bookTitle`. |
| **A whole book or a thesis** | `publicationType` `standalone book`, with the right `bookType`. |
| **An abstract, or something none of these fit** | Leave it as `other`, which keeps its note. |

In Classic, the matching fix is to set `publication_type`. The ref then migrates by the ordinary rules for that type and leaves this list.

## When the counts change

If a new Classic dump changes the row counts, that is expected: curators keep editing Classic. The migration log reports each list's row count, by Classic type for the first list and by migrated type for the second. If the files change between two runs on the same dump, that is a bug: report it.
