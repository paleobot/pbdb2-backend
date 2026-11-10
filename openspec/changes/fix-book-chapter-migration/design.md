## Context

`migrations/src/refs-migration/migrate-refs.js` maps Classic `publication_type` to a pbdb2 `publicationType` through a fixed lookup (`PUB_TYPE_MAP`, `mapPublicationType`). It then routes `pubtitle` by the target type (`mapPubtitle`) and `pubvol` and `pubno` likewise (`mapVolNo`). The mapping came from `migrate-refs-table` (2026-02-13), whose design gives the table with no reasoning for `book/book chapter → edited collection`.

Classic's `book/book chapter` meant either a whole book or a chapter in one, and the two titles show which. Counts are from `pbdb_2026_10_18`:

```
book/book chapter (3,710)       title shape              count
  reftitle ≠ pubtitle, both     chapter + its book       3,045
  pubtitle only                 whole book                 618
  equal titles                  book title entered twice    16
  reftitle only                                             15
  neither                                                   16
```

Classic `book` (1,694, → `standalone book`) has 314 rows with two different titles. The 78 with editors are chapters. The 236 without are mixed:
- articles in journals or series
- monographs in a series
- chapters with no editors recorded
- at least one publisher

Matching their `pubtitle` against known journal, series and book titles places only about 80 cleanly, 32 ambiguously, and leaves 157 unmatched.

The migrated rows are validated by the reference `db` variant. It accepts any declared field on any type and applies no create rules, so a reclassified row with no editors still loads.

## Goals / Non-Goals

**Goals:**
- Classic chapters migrate as `article in edited collection` with their book title in `bookTitle`.
- No title, volume or number of a Classic `book` ref with two titles is silently dropped. What the migration cannot place goes where a curator can find it.
- Every other ref migrates exactly as today, and every downstream count in the runner is reproduced.

**Non-Goals:**
- Guessing the type of the 236 ambiguous `book` rows. That is left to curation.
- The broader `pubvol`/`pubno` loss on book types. `mapVolNo` keeps them only for journal articles and serial monographs. Classic `book chapter` has 787 rows with a volume and 67 with a number, `book/book chapter` 1,105 and 172, and `book` 247 and 74. Apart from the 236 rows in D3, this change does not touch it. It goes to the backlog (see Open Questions).
- Structured editors, the PBot refs migration, the API, the schema and the DDL.
- RIS output, which is the follow-up change.

## Decisions

### D1. The type of a `book/book chapter` ref depends on its titles

A `book/book chapter` ref whose trimmed `reftitle` and `pubtitle` are both non-blank and differ maps to `article in edited collection`. Every other `book/book chapter` ref maps to `edited collection`, as today.

`mapPublicationType` takes the whole source row instead of only `publication_type`. `PUB_TYPE_MAP` stays the table for every type whose mapping is fixed. The two title-dependent types (D2 is the other) are handled in one small function beside it, `classifyByTitles`, so the lookup stays readable and the exceptions are in one place.

The existing `mapPubtitle` then routes `pubtitle` to `bookTitle` with no change, because it already keys on the target type. The `pubtitle` title fallback (`isPubtitleTitle`) also needs no change: it applies only when `reftitle` is blank, and those rows stay `edited collection`.

Equal titles stay `edited collection`, because the likeliest reading is the book's title entered in both fields.

Placeholder titles such as "Taxonomic Names" (13), "Brachiopoda" (8) and "Taxonomic descriptions" (6) become chapters with the book in `bookTitle`. That is right, since they name the part of the book the ref cites.

*Alternatives:*
- A rule on editors, as Classic's RIS writer used. It leaves the 1,761 chapters with no editors as whole books and keeps losing their book title.
- Mapping the whole Classic type to `article in edited collection`. That is wrong for the 618 whole books.

### D2. A Classic `book` ref with two titles and editors is a chapter

A `book` ref with two different titles (D1's test) and editors maps to `article in edited collection`, with `bookTitle` from `pubtitle`. There are 78 such rows. "Has editors" means `buildEditors` returns a value, from `ref_editors` or the `editors` column, so the rule agrees with what the row will carry. This rule takes precedence over the `book` entry in `PUB_TYPE_MAP`, so these rows get no `bookType`.

*Alternative:* leaving them as `standalone book`. The sample is uniformly chapters ("Chapter 7 - Devonian" in *The Geology of Pennsylvania*, ed. Schultz, pp. 109–127), so that would keep a loss the migration can fix with confidence.

### D3. Other `book` refs with two titles keep their container in `comments`

A `book` ref with two different titles and no editors (236) stays `standalone book` with `bookType: "monograph"`. Its `pubtitle`, `pubvol` and `pubno` are written into `comments` as a note:

```
Published in: <pubtitle>, vol. <pubvol>, no. <pubno>
```

The volume and number parts are left out when blank (111 have a volume, 37 a number). The note follows any existing comments after `; ` (27 rows have comments), and stands alone otherwise. The fixed prefix lets a curator find every such row with one query.

*Alternatives:*
- Guessing journal or series from a title match. Too few match, the matches are ambiguous, and a wrong confident type is harder to find than a coarse honest one.
- Putting `pubtitle` in `bookTitle` or `seriesTitle` on a `standalone book`. The db variant would accept it, but it asserts a relationship the data doesn't support, and volume and number would still have nowhere to go.
- Dropping it, as today. That loses what a curator needs to reclassify the row.

### D4. Counts are logged and asserted, not inferred

The script logs a count for each rule (D1 chapters, D2 chapters, D3 notes) beside the existing publication-type summary. The spec states the expected counts for the current source: 3,045, 78 and 236.

The type summary moves by 3,123 out of `edited collection` and `standalone book` into `article in edited collection`:

| publicationType | Before | After |
|---|---:|---:|
| article in edited collection | 2,589 | 5,712 |
| edited collection | 3,711 | 666 |
| standalone book | 2,471 | 2,393 |

The PBDB-only figures are confirmed on the first run and written into the spec.

## Risks / Trade-offs

- **[A chapter-shaped row is really a whole book with a subtitle in `pubtitle`]** → It becomes a chapter whose `bookTitle` is the subtitle. No text is lost, and the sample showed none. Curation can reverse it.
- **[The comments note mixes provenance into curator text]** → The fixed prefix keeps it findable and separable, and it applies to only 236 rows.
- **[Re-running the refs step disturbs downstream data]** → The runner rebuilds everything in order and asserts its totals. Only the refs payload changes, and permids are minted the same way, so collections, opinions, specimens and taxa must come out identical. Any change in a downstream count stops the run.
- **[The 1,761 reclassified chapters with no editors fail create-time rules if edited]** → This is the same as other legacy rows that predate those rules, and it is already noted in the backlog under PATCH validation.
- **[Aurora diverges from localhost until it is rebuilt]** → Recorded in tasks. Aurora is rebuilt with the next scheduled rebuild, as in earlier migration fixes.

## Migration Plan

1. Implement D1 to D4 in `migrate-refs.js`, with unit tests for each title shape and the note format.
2. Run the full migration runner against localhost `pbdb`, and compare the totals with the previous run. Only the publication-type summary may differ.
3. Spot-check rows by legacy ID: a D1 chapter, a D2 chapter, a D3 note with and without existing comments, and an equal-titles `edited collection`.
4. Update the counts in the `refs-migration` spec scenarios to the measured values.
5. Rebuild Aurora `pbdb2_migration_test` later. The procedure is unchanged.

Rollback: revert the commit and re-run the runner. The previous mapping is reproduced exactly.

## Open Questions

- Should the broader `pubvol`/`pubno` loss on book types go to `docs/api-design-backlog.md`, or into a follow-up migration change? This change is the natural place to record it.
