# Reidentifications: how Classic picks the current identification

**Status:** reference. Written 2026-11-20 against the `reidentifies_id` chain design; that design was replaced
on 2026-11-23 by `replace-occurrences-with-identifications` (the star shape, option C below). What remains
current is the evidence for Classic's rule and the comparison with `derive_occurrences()` (last section).
**Measured:** 2026-11-20 and 2026-11-24 against MariaDB `pbdb_2026_10_18`. Classic code references are to the
`classic` repo.
**Concerns:** rule 2 and the winner paragraph of `occurrences.md` in this folder; D4 of the archived
`replace-occurrences-with-identifications` design.

## Summary

The schema design treated `reidentifications.most_recent` as unreliable, because in 555 multi-reidentification
chains the `YES` row is not the last one entered. Classic, however, defines "most recent" as **most recently
published**, not most recently entered. Almost all of those 555 cases are Classic's rule working as designed.

`derive_occurrences()` now ranks by the same rule, with one difference: the original identification competes,
where in Classic it never does. That changes the winner on 775 occurrences (see the last section). Whether the
original should compete was put to Andrew on 2026-11-24 and is open.

The 2026-11-20 concern, kept for the record: had the migration built the chain in `reid_no` order, 2.0's current
identification would have differed from Classic's for about 550 occurrences, and `reidentifies_id` would have said
that one identification supersedes another where Classic says the opposite (a reidentification entered in 2010 from
an 1894 paper "superseding" one from a 2002 paper).

## Classic's model

```
 occurrences (≈2.0M)                    reidentifications (35,492)
 ┌────────────────────────────┐         ┌──────────────────────────────┐
 │ occurrence_no  ◄───────────┼─────────┤ occurrence_no                │
 │ collection_no, reference_no│   1:N   │ reid_no                      │
 │ taxon_no + genus/species…  │         │ collection_no, reference_no  │ ◄─ its own reference
 │ abund_value/unit           │         │ taxon_no + genus/species…    │
 │ plant_organ, plant_organ2  │         │ plant_organ                  │
 │ reid_no  (cache) ──────────┼────────►│ most_recent YES/NO (cache)   │
 └────────────────────────────┘         └──────────────────────────────┘
                 │ data service build
                 ▼
     occ_matrix: one row per (occurrence_no, reid_no), latest_ident = 1 on one
```

- A reidentification is entered against the session's reference. It says "according to reference R, this
  occurrence is taxon T." It is an independent act with its own reference and people, as the schema
  design's own measurements show.
- Classic picks the current identification in `setMostRecentReID` (`lib/PBDB/OccurrenceEntry.pm:2023`,
  called at lines 1759 and 1795 when a reidentification is saved). The same logic exists as the batch
  repair script `scripts/old/setMostRecent.pl`:

  ```sql
  SELECT re.* FROM reidentifications re, refs r
  WHERE r.reference_no = re.reference_no AND re.occurrence_no = ?
  ORDER BY r.pubyr DESC, re.reid_no DESC
  ```

  The first row gets `most_recent = 'YES'` and its `reid_no` is copied to `occurrences.reid_no`; the rest get
  `'NO'`. So the rule is: **the reidentification from the most recently published reference wins; same-year
  ties go to the later-entered one.**
- The original occurrence never competes. If any reidentification exists, a reidentification is current, even
  in the 775 cases where the original occurrence's reference is newer than the winning reidentification's.
- Classic runs this rule only when a reidentification is saved. Editing a reference's `pubyr` later does not
  recompute it.
- `occ_matrix.latest_ident` matches `most_recent` on all 33,370 reidentified occurrences, so the data
  service, maps, downloads and diversity curves all use this rule. It is the same idea as taxonomic opinions:
  the latest publication wins.

## The numbers

| | chains |
|---|---|
| Reidentified occurrences with more than one reidentification | 1,822 |
| `YES` row is not the last one entered (the design's "anomaly") | 554 |
| …of which `YES` is exactly what Classic's pubyr rule picks | **549** |
| `YES` disagrees even with Classic's own rule | 17 |

(The design measured 555 of 1,802 on the older Postgres-ported mirror; this dump is newer.)

The 17 genuine misses look like stale caches. For example, reidentifications 12120–12123 were created in
2005 but now sit on references with `pubyr` 2023, and 39704–39708 were created in May 2022 on references
now dated 2023. The likely story is that a reference's year was edited later (for example from "in press"),
and Classic never recomputed the flag.

Other facts relevant to a read-time rule:

- Every reidentification's reference has a 4-digit `pubyr` (`varchar(4)`); none is NULL or empty.
- 155 occurrences have two or more reidentifications from the same year, so the entry-order tiebreak matters.

## How the 2.0 shape could record this (2026-11-20)

Option C was adopted on 2026-11-23 as `identifications`, each non-root row pointing at its root through
`occurrence_permid`. Its ranking differs from the one sketched here in one way: the root competes (see the last
section).

```
 A. Linked list by reid_no   root ◄ r1 ◄ r2 ◄ r3        as designed; ~549 heads differ from Classic
 B. Linked list by pubyr     root ◄ r2 ◄ r1 ◄ r3        matches Classic at migration time, but the order is
                                                        a cache of reference years: goes stale exactly like
                                                        most_recent, and a new old-paper reidentification
                                                        has to be spliced into the middle
 C. Star                          ┌─ r1                  every reidentification points at the root occurrence;
                            root ◄┼─ r2                  current = derived: argmax(reference publicationYear,
                                  └─ r3                  then entry order) over the reidentifications, else
                                                         the root
```

Option C looks like the best fit:

- It records only what Classic actually knows: "reidentification R identifies occurrence O, per reference P."
- The ranking lives in the derived layer, which keeps the design's own rule: never store a current
  identification.
- It reproduces Classic exactly, except the 17 stale caches, which it corrects.
- "Current occurrences in collection X" becomes a group-by-root rather than a recursive walk of a chain.

The cost is losing a "this identification responds to that one" link. Classic never recorded one, and a
future 2.0 entry UI could add it explicitly if it is wanted.

~~Under C, `reidentifies_id` would keep its column but change meaning.~~ Superseded: the column was dropped in
favour of `occurrence_permid`.

## Other points

- **Counts have drifted.** The design measured 35,098 reidentifications over 32,994 occurrences; the current
  dump has 35,492 over 33,370. The 2,019,190 row target and the exclusion counts need re-measuring against
  `pbdb_2026_10_18`. Still open: the mapping document's counts come from the older mirror.
- **What an OCC permid identifies.** Each reidentification gets its own OCC permid, so a permid names an
  identification act, and "the occurrence" is the root row's permid. Abundance and plant organs describe the
  fossil in the collection, but in Classic they exist only on the original occurrence. Before the API exposes
  `/occurrences/{permid}`, we should decide what a reidentification's permid returns. Partly answered
  2026-11-23 (`port-identifications-to-prefixed-permids` D1): a non-root `OCC` permid is not an occurrence, as a
  non-root `TXN` permid is not a taxon, and abundance has its own `ABD` table. What the API returns for one is
  still open.
- **Classic's read options.** If memory serves, the Classic data service lets callers choose original,
  reidentified, latest, or all identifications (an `idtype`-style parameter; not yet checked). That is an
  API concern, but it is another reason to keep the full set of identifications rather than a chain with a
  single winner.

## Reproducing the numbers

Against the MariaDB dump:

```sql
-- Is the YES row the one setMostRecentReID would pick?
WITH r AS (
  SELECT re.occurrence_no, re.reid_no, re.most_recent,
         ROW_NUMBER() OVER (PARTITION BY re.occurrence_no ORDER BY rf.pubyr DESC, re.reid_no DESC) AS by_pubyr,
         ROW_NUMBER() OVER (PARTITION BY re.occurrence_no ORDER BY re.reid_no DESC)                AS by_reid,
         COUNT(*)     OVER (PARTITION BY re.occurrence_no)                                          AS n
  FROM reidentifications re LEFT JOIN refs rf ON rf.reference_no = re.reference_no
)
SELECT SUM(n > 1 AND most_recent = 'YES')                                  AS multi_chains,
       SUM(n > 1 AND most_recent = 'YES' AND by_reid <> 1)                 AS yes_not_last_entered,
       SUM(n > 1 AND most_recent = 'YES' AND by_pubyr <> 1)                AS yes_not_pubyr_pick,
       SUM(n > 1 AND most_recent = 'YES' AND by_reid <> 1 AND by_pubyr = 1) AS explained_by_pubyr
FROM r;

-- Does occ_matrix follow most_recent?
SELECT COUNT(*) AS reidentified, SUM(m.reid_no = y.reid_no) AS latest_is_yes
FROM occ_matrix m
JOIN (SELECT occurrence_no, reid_no FROM reidentifications WHERE most_recent = 'YES') y USING (occurrence_no)
WHERE m.latest_ident = 1;

-- Does the original ever outrank the winning reidentification by publication year?
SELECT COUNT(*) AS yes_reids, SUM(ro.pubyr > rr.pubyr) AS original_newer_pub
FROM reidentifications re
JOIN occurrences o USING (occurrence_no)
JOIN refs ro ON ro.reference_no = o.reference_no
JOIN refs rr ON rr.reference_no = re.reference_no
WHERE re.most_recent = 'YES';
```

## Comparison with `derive_occurrences()` (2026-11-24)

`derive_occurrences()` ranks a reidentified occurrence's identifications by reference `publicationYear`, then the
lineage's first `created_at`, then its first id, and the root is a candidate. Against Classic, over the 33,370
reidentified occurrences:

| Outcome | Occurrences |
|---|---|
| A reidentification wins, the same row as Classic's `YES` | 32,578 |
| A reidentification wins, Classic's rule agrees, the stored `YES` is stale | 17 |
| The original wins in 2.0; Classic shows a reidentification | 775 |

Among reidentification winners the `created_at` tie-break picks the same row as `reid_no DESC` every time. Of
the 775, the original and Classic's winner differ in `taxon_no` on 712 (708 with a different written name, 4 with
the same), share the `taxon_no` but not the written name on 34, and agree on both on 29. The original was entered
first in 774 of them. A sample reads mostly as a later, more specific reidentification citing an older specialist
paper than the faunal list the occurrence came from. Written up for Andrew as "Occurrences: where 2.0's winning
identification differs from Classic's" (2026-11-24); whether the original competes is open.

```sql
-- The query does not apply the 626 + 15 exclusions; the 2.0 lineage order is approximated as
-- entry time, then reidentification before original, then reid_no (roots load first, lower ids).
WITH c AS (
  SELECT o.occurrence_no, 0 AS reid_no, CAST(rf.pubyr AS UNSIGNED) AS yr, o.created,
         0 AS is_reid, NULL AS most_recent, o.taxon_no
  FROM occurrences o JOIN refs rf ON rf.reference_no = o.reference_no
  WHERE o.occurrence_no IN (SELECT occurrence_no FROM reidentifications)
  UNION ALL
  SELECT re.occurrence_no, re.reid_no, CAST(rf.pubyr AS UNSIGNED), re.created,
         1, re.most_recent, re.taxon_no
  FROM reidentifications re JOIN refs rf ON rf.reference_no = re.reference_no
),
r AS (
  SELECT c.*,
    ROW_NUMBER() OVER (PARTITION BY occurrence_no
      ORDER BY yr DESC, created IS NULL, created DESC, is_reid DESC, reid_no DESC) AS pbdb2,
    ROW_NUMBER() OVER (PARTITION BY occurrence_no
      ORDER BY is_reid DESC, yr DESC, reid_no DESC)                                  AS classic
  FROM c
)
SELECT COUNT(DISTINCT occurrence_no)                             AS reidentified,
       SUM(pbdb2 = 1 AND is_reid = 0)                            AS original_wins_in_2_0,
       SUM(pbdb2 = 1 AND is_reid = 1 AND most_recent = 'YES')    AS same_as_classic_yes,
       SUM(pbdb2 = 1 AND is_reid = 1 AND classic <> 1)           AS tie_break_disagrees,
       SUM(classic = 1 AND most_recent <> 'YES')                 AS stale_yes_flags
FROM r;
-- 33370 | 775 | 32578 | 0 | 17
```
