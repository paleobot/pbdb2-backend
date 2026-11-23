## Context

`main` (57 commits ahead of the branch point) retired UUIDv7 permids. Every permid is `<PREFIX>-<number>-<CC>` text, collated
"C", registered once in `permids`, and checked by `permid_is_valid(value, prefix)`. One prefix per table that creates
entities; derived tables have none (a taxon's permid is its root name opinion's `TXN` permid). `main` also gave the
old versioned `occurrences` table the `OCC` prefix, with `OCC-<occurrence_no>` for migrated occurrences and the sequence for
reidentifications, because `reid_no` overlaps `occurrence_no`.

## Decisions

### D1 - `identifications` carries `OCC` for every row

`name_opinions` uses `TXN` for root and non-root rows alike, and the derived `taxa` has no prefix. The same shape here: every
identification is `OCC`, so a root's permid is the occurrence's, and `occurrences` (derived) has no prefix of its own. This keeps
Classic's `occ:` correspondence for migrated occurrences, which is why `OCC` was added. Rejected: a new `IDN` prefix for
identifications, which would have retired `OCC` and that correspondence. A further identification's `OCC-<n>` is not an occurrence
(as a non-root `TXN` permid is not a taxon); `occurrence_permid` is what names the occurrence.

### D2 - `occurrence_abundances` takes `ABD`

Its permid is only a lineage id, always minted from `permid_abd_seq` (Classic has no abundance number). Its `occurrence_permid` is
an `OCC` column. Digits for `ABD` are A=10, B=11, D=13, so `101113` in `permid_prefix_digits`; the first mint is
`ABD-10000000-93`.

### D3 - One abundance per occurrence is a deferred exclusion constraint

The old design used a unique index on version-1 rows because a unique index on current versions rejects a new version while the old
head still stands. `main` already solved that for `permid_no` with `EXCLUDE ... WHERE (succeeded_by_id IS NULL) DEFERRABLE INITIALLY
DEFERRED`; the same device on `occurrence_permid` gives "at most one current abundance" directly, and the version-1 index goes.

### D4 - The derived cache follows `taxa`

`occurrences.permid` is `text COLLATE "C"`, an FK to `permids`, the `OCC` CHECK and UNIQUE, with `permid_no UNIQUE`, as `taxa` does.
`derive_occurrences(seed)` takes `text[]`. Its ranking and the removed-root and plant-organ rules are unchanged.

## Risks / Trade-offs

- [`OCC` is now on rows that are not occurrences] -> the same trade `TXN` makes; `occurrence_permid` is the join key.
- [Branch was 57 commits behind] -> rebased; three files conflicted (the occurrences DDL, the occurrence spec, the mapping doc) and
  were resolved in favour of the identification design.
