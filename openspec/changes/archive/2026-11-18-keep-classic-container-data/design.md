## Context

The Classic refs migration (`migrations/src/refs-migration/migrate-refs.js`) reads every Classic ref in one query, then builds each ref's jsonb from a set of exported, pure transforms:
- `mapPublicationType(ref, editors)` picks the target type: the two title rules first, then `PUB_TYPE_MAP`. A NULL `publication_type` becomes `other`.
- `mapTitle(ref, type)` returns `reftitle`, or `pubtitle` for whole-book types when `reftitle` is blank.
- `mapPubtitle(ref, type)` routes `pubtitle` to `journalTitle`, `seriesTitle` or `bookTitle`.
- `mapVolNo(ref, type)` writes `journalVolume`/`journalNumber` or `seriesVolume`.
- `containerNote(ref, editors, type)` writes `Published in: <pubtitle>, vol. <pubvol>, no. <pubno>` for two cases: two-title `book` refs without editors (236), and chapters with a volume or number (1,907).
- `buildComments` appends the note to `comments` after `; `.

Anything else these transforms don't place is dropped: 4,599 refs in `pbdb_2026_10_18` (proposal table).

A single read of Classic data informs this design. It comes from the 2026-11-18 exploration and a scratch simulation that ran the real transforms over every Classic ref.

## Goals / Non-Goals

**Goals:**
- Every non-blank Classic `pubtitle`, `pubvol` and `pubno` ends up in exactly one of two places: a field, or the container note. A value already in a field is repeated in the note only where the existing chapter note does so.
- The existing 236 book notes and 1,907 chapter notes come out byte-identical.
- Untyped refs that are plainly journal articles migrate as journal articles, and every untyped ref is listed for curators.
- `serial monograph` holds its series number in a field.

**Non-Goals:**
- Parsing `pubtitle` (series, institutions, "In X (ed.), …"). The chapter-series spike showed it is unreliable.
- Retyping untyped refs as anything other than `journal article`. 22 have a pubtitle whose majority type is `serial monograph`, 31 a book or chapter type, and 3 `abstract`. They stay `other` with a note and are on the review list.
- Moving thesis institutions to `publisher`. `publisher` is already set on most theses, and the thesis pubtitle mixes the degree, the institution and page counts.
- A container field on `other`. That is a model question, recorded in the backlog.
- Any change to RIS. `add-ris-reference-output` is updated after this change is archived.

## Decisions

### D1. Untyped refs: journal article when the title's majority type is `journal article`

A ref with a NULL `publication_type` migrates as `journal article` when two conditions hold:
- its trimmed `pubtitle`, lowercased, is the `pubtitle` of at least one typed Classic ref;
- more than half of the typed Classic refs with that lowercased pubtitle are `journal article`.

Otherwise it stays `other`. Any type that `classifyByTitles` would give still comes first, but that never applies to NULL-type refs.

Measured on `pbdb_2026_10_18`:

| Rule | Untyped refs typed `journal article` |
|---|---:|
| Exact match against any Classic journal-article pubtitle (the proposal's figure) | 676 |
| Journal plurality | 665 |
| **Journal majority (> 50%)** | **658** |

The majority rule excludes 18 refs whose title Classic mostly uses for other types. These are exactly the false positives in the sample:
- *United States Geological Survey Professional Paper* (153 of 336 typed refs are journal articles)
- *GSA Memoir*
- *GSA Abstracts with Programs*
- *Topics in Geobiology*
- *Proceedings of the North American Paleontological Convention*
- *University of Texas Publication*

It keeps real journals with few typed refs, such as *Transactions of the Royal Society Edinburgh B* (44 untyped refs, one journal article). Some weak matches remain, such as *Fossil Vertebrates of Africa* (5 refs, one journal article). They keep all their data in `journalTitle`, `journalVolume` and `journalNumber`, so a curator's retype loses nothing.

*Alternatives:*
- **Any exact match (676):** includes the USGS and GSA series above.
- **A minimum count of journal articles per title:** drops *Trans. R. Soc. Edinburgh B*, which is real.
- **Normalizing punctuation before matching** ("C.R." vs "C. R."): more matches, but harder to defend. The exact match is easy to explain to a curator.
- **Taking the majority type, whatever it is:** retypes 53 more as serial monographs or books on weaker evidence. That is out of scope (Non-Goals).

### D2. The vote is computed from Classic in the same run

A pre-pass over the refs the script already reads builds `Map<lowercased trimmed pubtitle, { journal, typed }>` from refs with a non-NULL `publication_type` and a non-blank `pubtitle`. Untyped refs don't vote. PBot refs aren't part of it, because the Classic script never reads them. The result is a pure function of the source dump, so re-runs are deterministic, and a new Classic dump is re-scored automatically.

`mapPublicationType(ref, editors, journalTitles)` takes the map as a third argument, so unit tests can pass a small one. The map holds counts, not a precomputed set, so that the review list (D7) can print the share.

### D3. What a field holds

For a ref of target type T:
- **`pubtitle`** is held when `mapPubtitle` routes it to a field, or when it equals the stored `title`, ignoring case. That covers the whole-book fallback and single-title books entered twice.
- **`pubvol`** is held when T is `journal article` (`journalVolume`) or `serial monograph` (`seriesVolume`).
- **`pubno`** is held when T is `journal article` (`journalNumber`) or `serial monograph` (`seriesNumber`, D6).

A ref gets a container note when at least one of its non-blank values is not held. This one test reproduces both existing triggers:
- a two-title book's `pubtitle` is not held;
- a chapter's volume or number is not held.

It needs no type-by-type list.

### D4. The note's content and form

The note lists, in order and joined with `, `:
- the trimmed `pubtitle`, unless it is blank or is the ref's own title (equal to `title`, ignoring case);
- `vol. <pubvol>`, when non-blank;
- `no. <pubno>`, when non-blank.

Like the chapter note, it repeats a value a field also holds, so the note reads on its own. It never repeats the ref's own title. The list gets one of three prefixes:

| Form | When | Example |
|---|---|---|
| `Published in: <list>` | the list starts with a container `pubtitle`, or T is `article in edited collection` or `other` | `Published in: Geologisches Jahrbuch, Beihefte, vol. 85` |
| `Source: <list>` | T is `unpublished`, or `standalone book` with `bookType` Ph.D. thesis, M.S. thesis or compendium, and the list starts with a `pubtitle` | `Source: PhD thesis, Cornell University` · `Source: pers. comm.` · `Source: MolluscaBase (2015)` |
| `Published as <list>` | the list has no `pubtitle` and T is a whole work (any other type) | `Published as vol. 5` for vol. 5 of *Catalogue of the Fossil Mammalia in the British Museum* |

`Source:` takes precedence over `Published in:`. A chapter or `other` ref with a volume but no pubtitle keeps `Published in: vol. 3, no. 2`, as `keep-chapter-volume-in-note` D3 specified.

Simulated on `pbdb_2026_10_18` with D1 applied:

| Target | Form | Notes |
|---|---|---:|
| article in edited collection | Published in | 1,907 (unchanged) |
| standalone book / monograph, two-title `book` | Published in | 236 (unchanged) |
| other | Published in | 2,449 |
| standalone book / guidebook | Published in | 171 |
| standalone book / Ph.D. thesis, M.S. thesis | Source | 142 |
| standalone book / compendium | Source | 80 |
| unpublished | Source | 46 |
| standalone book (monograph, guidebook, Ph.D. thesis, compendium) | Published as | 189 |
| **Total** | | **5,220** (3,077 new) |

*Alternatives:*
- **`Published in:` everywhere.** Simplest, but it gives "Published in: pers. comm.", "Published in: PhD dissertation, Mainz", and "Published in: vol. 5" for a whole book, which reads as if the book were inside a volume.
- **A label per type** ("Thesis:", "Database:"). It's more precise, but the compendium pubtitles mix databases and journals ("Memoirs of the Queensland Museum, vol. 48"), so a narrow label would often be wrong. `Source:` is true of all of them.

### D5. `containerNote` signature

`containerNote(ref, jsonb)` takes the built jsonb (type, `bookType`, `title` and the routed fields) in place of `(ref, editors, type)`, and decides "held" from what was actually written. That way the note can't contradict the fields. `buildJsonb` builds the fields first, then calls it, then `buildComments`. The existing `editors` and two-title test disappears: D3 covers it.

### D6. `seriesNumber` on `serial monograph`

`payloadSchemas/reference.schema.js` gains `seriesNumber: { type: "string", maxLength: 10 }`, a copy of `journalNumber`, placed after `seriesVolume` so that responses and CSV columns list it there.
- **Per-type fields:** `serial monograph`'s `fields` gains it, and its `required` list does not change.
- **Variants:** `in-create`, `in-patch`, `out` and `db` follow from the per-type table as for every other field.
- **API:** no code change. JSON, CSV columns and OpenAPI are derived from the schema.
- **Migrations:** `mapVolNo` writes `seriesNumber` from `pubno` on serial monographs (863). PBot `publicationNumber` maps to it on serial monographs (0 rows today).

### D7. Untyped refs review list

Every run writes `src/refs-migration/untyped-refs-review.csv` beside the script. Like the single-title-books list, it is version-controlled and byte-identical across re-runs of one dump. It is UTF-8 CSV, one row per Classic ref with a NULL `publication_type` (1,183), sorted by `reference_no`:

`reference_no,permid,type,journal_share,authors,year,title,pubtitle,pubvol,pubno`

- **`type`** is the target type: `journal article` or `other`.
- **`journal_share`** is `<journal>/<typed>` from D2, blank when no typed ref shares the pubtitle.
- **`authors`, `title`** and the CSV quoting are written exactly as in the single-title-books list. Its writer is shared, not copied.

Every untyped ref is listed, not just the 658. The 525 that stay `other` are the larger curation job, and listing both lets a curator check the rule from both sides.

### D8. Logging

- **Container notes:** the count now has one line per form and target type, as in the D4 table.
- **Untyped refs:** a new line gives the number typed `journal article` by D1 and the number left `other`.
- **Review list:** a new line gives the untyped-refs review list's row count.
- **Warnings:** the NULL-type warning stays.

## Risks / Trade-offs

- **[A wrong journal match]** For example, a series volume whose title Classic mostly files as journal articles. → The majority rule removes the measured false positives (D1), and the review list shows each match with its share. The data is kept in fields either way, so a retype loses nothing.
- **[A value both stored and noted]** → D3/D5 decide "held" from the built jsonb. The unit tests assert, for each type, that a held volume or number isn't noted on non-chapter types. A full-run check confirms the 1,907 + 236 existing notes are unchanged, byte for byte.
- **[`Source:` is vaguer than a field]** → Accepted. The note keeps the text and a curator can move it. Filters and RIS see it only as a note (`N1`).
- **[Type counts shift by 658]** API type filters and the per-type mapping summary change. → Expected. The runner's total ref count and every other entity's count must reproduce exactly. Permids don't move, because they come from `reference_no`.
- **[Notes grow `comments`]** → `comments` is free text in the `db` variant. The longest new note is bounded by `pubtitle` (longtext) and is no different from existing notes.

## Migration Plan

1. Schema: `seriesNumber`, with its tests.
2. Refs migration: D1–D5 and D7–D8, with unit tests per form and type.
3. PBot refs migration: the `publicationNumber` → `seriesNumber` row.
4. Re-migrate localhost with the full runner. Check:
   - the totals;
   - 658 refs changed type;
   - 5,220 notes by form, with the 2,143 existing notes byte-identical;
   - 863 `seriesNumber` values;
   - review list row count 1,183;
   - a second run's CSVs byte-identical.
5. Update the backlog's "Known data issues". Aurora is rebuilt later, with the DOI refresh.

Rollback: revert the commit and re-run the runner. No data outside `refs` depends on the new fields or types.

## Open Questions

- None blocking. The D1 and D4 figures come from a simulation using `ref.editors` text in place of `ref_editors` rows. The chapter and book counts matched exactly (1,907 and 236), but the full run's log is authoritative, and the spec's counts are corrected from it if they differ.
