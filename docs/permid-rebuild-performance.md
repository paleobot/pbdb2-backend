# Prefixed Permids and Rebuild Performance: Measured Findings

**Status:** Design reference (measured; options A and B adopted by `collate-c-permids`,
2026-10-30)
**Audience:** PBDB2 backend contributors
**Subject:** What the switch from UUIDv7 to prefixed text permids
(`adopt-prefixed-sequence-permids`) cost in bulk write performance, where the cost
comes from, and the options for getting it back

---

## 1. Why this document exists

After `adopt-prefixed-sequence-permids` was applied, the migration runner and the taxa
rebuild were visibly slower than before. This document records the measurements taken on
2026-10-29 so a later decision (fix now, fix with the opinion write path, or accept) can
cite numbers instead of re-deriving them. `collate-c-permids` (2026-10-30) adopted
options A and B (§7) and added its own measurements here; its `design.md` holds the
decisions, and this document is the evidence.

"Decision n" below refers to the numbered decisions in the design of
`adopt-prefixed-sequence-permids`:
[`openspec/changes/archive/2026-10-30-adopt-prefixed-sequence-permids/design.md`](../openspec/changes/archive/2026-10-30-adopt-prefixed-sequence-permids/design.md).

The short version: **reads are unaffected; bulk writes are slower.** A full taxa rebuild
takes 539 s against 315 s with UUIDs (+71%). About half of that is the database collation
used to compare text permids, and about a third is the per-row CHECK and FK on the derived
taxa tables. With A and B adopted, the rebuild takes 396–421 s (§5).

## 2. Setup

- **Localhost:** PostgreSQL 16.15, database collation `en_US.UTF-8` (libc provider). `pbdb`
  is the TXN build (rebuilt 2026-10-29); `pbdb_pre_permids` is the UUID build of the same
  MariaDB dump (`pbdb_2026_10_18`).
- **Aurora:** `pbdb2_migration_test`, PostgreSQL 18.3, reached over the VPN.
- Both builds hold the same data: 525,805 taxa, 782,423 name opinions, identical counts in
  every table.
- The profiles ran on throwaway copies (`CREATE DATABASE … TEMPLATE pbdb`), dropped
  afterwards. The method is in §8.

## 3. What did not get worse

| Measure | UUID | TXN |
|---|---|---|
| Single taxon by permid (index scan, `EXPLAIN ANALYZE`) | 0.100 ms | 0.065 ms |
| Database size | 2,216 MB | 2,134 MB |
| Sort 525,805 permids (TXN under `COLLATE "C"`) | 463 ms (includes a text → uuid cast) | 152 ms |

The registry (`permids`) adds 251 MB, and the opinion tables are 9–15% larger (`permid_no`
columns). The UUID copy's `taxa` carries bloat from repeated rebuilds, which more than
offsets that. A text permid like `TXN-526271-74` is about the size of a 16-byte UUID.

The NOP → TXN rename (design decision 20) had no measurable effect: the NOP runs on
2026-10-28 and the TXN run on 2026-10-29 take the same time.

## 4. What got worse: migration runner, step by step

Seconds per step, from `migrations/src/run-migrations.log`. The log doesn't record the
target, so each run is attributed from its `persons` time (about 2 s on localhost, about
100 s on Aurora).

| Step | Localhost UUID (10-19) | Localhost text (10-28, 10-28, 10-29) | Localhost B only, A + B (10-30) | Aurora UUID (10-20) | Aurora TXN (10-29) |
|---|---|---|---|---|---|
| persons | 2 | 3, 3, 2 | 2, 2 | 106 | 105 |
| refs | 7 | 14, 14, 11 | 10, 9 | 42 | 92 |
| pbot-schemas | 6 | 12, 8, 7 | 8, 7 | 260 | 387 |
| authorities | 11 | 22, 20, 17 | 17, 14 | 38 | 60 |
| authority-opinions | 23 | 55, 52, 45 | 46, 39 | 120 | 280 |
| opinions | 39 | 118, 120, 99 | 77, 70 | 225 | 539 |
| collections | 36 | 54, 46, 43 | 41, 40 | 158 | 323 |
| specimens | 14 | 25, 21, 20 | 18, 17 | 50 | 90 |
| taxa (step alone) | 364 (10-21) | 610, 551, 549 | 519, 382 | 548 (10-21) | 739 |

The full Aurora run went from roughly 20 to 46 minutes. The 10-19 localhost run predates
the taxa runner step, so its taxa figure is the standalone UUID taxa run from 10-21.

The two 10-30 runs are the builds `collate-c-permids` compared: "B only" has the inlined
CHECK function and `cycle_members` sorted by number, with the permid columns still
default-collated; "A + B" adds `COLLATE "C"`. Every migration step is faster under A + B,
most of all `opinions` (99 → 70 s, of which B alone gives 99 → 77 s) and `taxa` (549 →
382 s, almost all of it A).

Aurora's migration steps roughly doubled, more than localhost's did. The likely reason is
extra round trips: `register_permids` and `mint_permids` add a call per batch, and
`pbot-persons` and `pbot-schemas` mint one permid per insert (decision 18), at about 70 ms
per round trip over the VPN. This was inferred, not profiled.

## 5. The taxa rebuild, profiled

Each variant truncates the derived tables (`taxa_linnaean`, `taxa_clades`,
`taxa_attachments`, `taxa`, `cycle_cuts`), as a `--createdb` run sees them, then times the
four functions `rebuild_taxa_full()` calls, in the same order and with the same `ANALYZE`s.
Every run produced 525,805 / 3,346 / 20,264 / 525,805 rows.

| Variant | linnaean | clades | attachments | taxa | **Total** |
|---|---|---|---|---|---|
| UUID build | 55.7 | 4.8 | 1.5 | 253.1 | **315** |
| TXN, as is | 120.1 | 7.3 | 4.2 | 407.8 | **539** |
| TXN without permid CHECKs on derived tables | 95.2 | 6.8 | 3.7 | 380.3 | 486 |
| TXN without permid CHECKs or FKs on derived tables | 81.2 | 6.6 | 3.4 | 363.8 | 455 |
| TXN with all 41 permid columns `COLLATE "C"` (constraints kept) | 93.3 | 6.7 | 3.0 | 317.7 | **421** |
| TXN, B only (10-30) | 102.5 | 7.2 | 4.0 | 416.8 | 530 |
| TXN, A + B, as adopted (10-30, two runs) | 81.6, 78.7 | 6.6, 6.9 | 2.7, 2.5 | 329.7, 307.8 | **421, 396** |

"Derived tables" means the five tables above: 18 permid CHECKs and 18 FKs to `permids`.
The collation variant changes every public `*permid` text column, opinion tables included,
and nothing else.

The 10-30 rows are copies of full builds from the DDL, not altered copies: "B only" is
`collate-c-permids` without the `COLLATE "C"` declarations, "A + B" is the change as
adopted. The two A + B runs, on the same copy, differ by 25 s, almost all of it in
`rebuild_taxa`, so a single run's total is good to about that much. What they show:

- A + B lands at 396–421 s, about what A alone gave (421 s), not the ~370 s that A's 118 s
  plus B's share of 53 s would suggest.
- B recovers little. On its own it saved 9 s, within the noise. `rebuild_linnaean` did
  improve both times (120 → 102 s without A, 93 → 79–82 s with it); `rebuild_taxa` did not
  move outside the noise. Measured alone, the new function is 4.6 times cheaper (1.90 s →
  0.41 s over 525,805 values in a `SELECT`), so most of the 53 s that dropping the CHECKs
  saved was something other than the function's own cost. What it was was not
  investigated.

### Where the 224 s goes

```
UUID build                                              315 s
+ permid comparisons under en_US.UTF-8          ~118 s  (measured: collation variant)
+ permid CHECKs on the derived tables             53 s  (measured)
+ registry FKs on the derived tables              31 s  (measured)
+ unexplained                                    ~22 s
= TXN build, as is                                      539 s
```

The parts were measured one at a time, and they don't simply add up: A + B together
measured 396–421 s (above). A + B + C has not been measured.

## 6. The causes

### 6.1 Collation (about 118 s)

Permid columns use the database default collation, `en_US.UTF-8`, so every sort, window
partition, temp-table index, merge join and `min()` over permids does a locale-aware string
comparison. The registry's own key is already `COLLATE "C"` (decision 4); the columns that
reference it are not, and the derive functions' temp tables inherit the default from them.

| 525,805 taxa permids | en_US.UTF-8 | `COLLATE "C"` |
|---|---|---|
| sort | 813 ms | 152 ms |
| self-join `taxa.concept_permid = taxa.permid` | 1,147 ms | 430 ms |
| sort by `split_part(permid, '-', 2)::bigint` (decision 17) | 90 ms | (n/a) |

Permids are ASCII codes, so locale-aware ordering does nothing useful for them, and the API
orders lists by `permid_no`, not by the text.

### 6.2 The CHECK function (53 s on the derived tables)

`permid_is_valid(value, prefix)` is PL/pgSQL. On every call it runs
`permid_check_prefix`, a regex, and `permid_check_digits`, which rebuilds the prefix's
digit string with `string_agg` over `unnest(string_to_array(prefix, NULL))`. Measured cost:
2.39 s for 525,805 values, about 4.5 µs per value, against 0.04 s to read the column. The
derived tables have 18 such CHECKs, so a full rebuild makes several million calls. The same
function guards every permid column on every table, so the migrations pay it too.

`collate-c-permids` replaced it with a plain SQL function that PostgreSQL inlines into
each CHECK, with the prefix's digits looked up in `permid_prefix_digits` (option B). §5
has what that recovered.

### 6.3 Registry FKs (31 s on the derived tables)

Each inserted permid value is a separate lookup into the 2.45-million-row `permids` table,
checked row by row by the FK trigger (a batched join of all 525,805 values takes 0.33 s).

### 6.4 Not attributed (about 22 s)

Not measured separately. Candidates: wider rows in the temp tables, and the numeric
tie-break sorts (decision 17).

## 7. Options

| | What | Recovers (taxa rebuild) | Also helps | Cost / trade-off |
|---|---|---|---|---|
| **A** | **Adopted** (`collate-c-permids`). Declare every permid column `COLLATE "C"` in `db/02-core.sql` and `db/03-taxa.sql` | ~118 s (measured); A + B: 118–143 s | migrations, future opinion writes, any permid sort or join | Small DDL edit. PG16 blocks `ALTER TYPE` under a generated column, but the DDL is always rebuilt, so the columns are just declared that way. Needs a full-content diff (see below). |
| **B** | **Adopted** (`collate-c-permids`). Rewrite `permid_is_valid` as a plain SQL function with precomputed prefix digits | 9 s alone, within noise (§5) | every table's inserts, so all migrations | Small. One function; the SQL permid tests already cover it. |
| **C** | Drop the permid CHECKs and FKs on the derived taxa tables | up to 84 s (measured together) | partial re-derivations on opinion writes | Reverses part of decision 11. The tables are rebuildable caches, every value comes from opinion columns that are already checked, and `assert_*_invariant()` re-checks them. But a derive bug would surface at assert time instead of insert time. |
| **D** | Fewer round trips: batch the per-insert mints in `pbot-persons`/`pbot-schemas`, or register permids in the same statement as the insert | Aurora migration time | Aurora runs only | Script changes. Decision 18 chose per-insert minting because those scripts can't know their rows up front. |
| **E** | Accept | — | — | Costs fall on rebuilds and migrations today. They will matter once the opinion write path exists, since every opinion write reruns part of the derivation. |

A and B were adopted together by `collate-c-permids` (2026-10-30), which leaves the
rebuild at 396–421 s against 315 s with UUIDs. C is a design decision and is still open;
what it can recover on top of A + B has not been measured.

### Correctness caveat for A

This section is the analysis `collate-c-permids` started from; the outcome is at its end.
The collation variant's row counts matched, but its contents were not compared. The two
collations order permids differently, because en_US largely ignores the hyphens and `"C"`
compares bytes (`-` sorts before every digit):

| en_US.UTF-8 | `"C"` |
|---|---|
| `TXN-1000-05` | `TXN-100-12` |
| `TXN-100-12` | `TXN-1000-05` |
| `TXN-99-40` | `TXN-99-40` |

Neither is numeric order. Equality does not change: en_US is a deterministic collation,
so two strings are equal only when their bytes are. Joins, `GROUP BY`, `DISTINCT`,
`PARTITION BY`, CHECKs and FKs give the same results under both. Only ordering can differ.
These are the places in `db/03-taxa.sql` where ordering on permid text could reach the
output (checked 2026-10-30):

| | Where | Text order? | Reaches output? |
|---|---|---|---|
| 1 | Union-find representatives, `lin_rep`/`con_rep` = `min(node)`, in all three derive functions | yes | No. They are only join and partition keys and are never stored (no derived table has a `_rep` column). A different member may become the label, but the groups are the same. |
| 2 | Contest orderings (accepted spelling, original, senior lineage, winning assignment) | no | They end in `opinion_id` or the permid number (decision 17), so every tie has the same winner. |
| 3 | `array_agg(DISTINCT concept_permid)`, stored as `cycle_cuts.cycle_members` | yes | Yes, but only the element order. `DISTINCT` sorts by the collation; the set of members is unchanged. 72 rows today (54 `taxa`, 18 `taxa_clades`). |
| 4 | `derive_taxa`'s cycle walk starts from `FROM _dtu_peel p LIMIT 1`, with no `ORDER BY` | indirectly | No. The start row depends on the query plan and the stored row order, and so may the order in which coexisting cycles are cut, but that order can't change the result (below). |
| 5 | `classification_path` (ltree) | no | ltree compares labels bytewise, whatever the collation. |

The API orders lists by `permid_no`, never by permid text.

Only 3 reached stored output. 4 looked like it could change the taxonomy
(`containing_concept_permid`, `classification_path`) when several cycles exist at once,
but it can't, as `collate-c-permids` (design decision 5) showed:

- `_dtu_node` gives each concept exactly one container, so the containment graph is
  functional and its cycles never share a node.
- Cutting one cycle's weakest edge changes only that node's own edge. Its replacement is
  its next-best assignment, which depends only on its own opinions and the excluded set.
  Every other cycle is still there with the same weakest edge.
- So two cuts give the same state in either order. The loop always terminates, so every
  order ends at the same set of cuts, and each logged cycle has the same members. The same
  holds for the seeded path's loop over `_dtu_seed_con_reps`.

The walk start therefore keeps its `LIMIT 1` with no `ORDER BY`. `collate-c-permids`:

- sorted `cycle_members` by number in all five places that build it (`derive_linnaean` and
  `derive_taxa`, full and seeded; `derive_taxa_clades`), as decision 17 does for the
  tie-breaks;
- built localhost twice from the DDL, once with the permid columns under en_US and once
  under `"C"`, and diffed the full contents of `taxa_linnaean`, `taxa_clades`,
  `taxa_attachments`, `taxa` and `cycle_cuts` (every column but `id` and `created_at`).
  They were identical, including the 72 `cycle_cuts` rows, 45 of which list their members
  in a different order by text than by number;
- checked the seeded paths, which the profile doesn't run (§8).

## 8. Method, for reproducing

All runs used the localhost credentials from `.env`. Nothing may be connected to the
template database while a copy is made.

**One profile run** (repeat per variant):

```sql
-- psql -X -v ON_ERROR_STOP=1 -d scratch_taxa_prof, with \timing on
TRUNCATE taxa_linnaean, taxa_clades, taxa_attachments, taxa, cycle_cuts;
CHECKPOINT;
SELECT rebuild_linnaean();          ANALYZE taxa_linnaean;
SELECT rebuild_taxa_clades();       ANALYZE taxa_clades;
SELECT rebuild_clade_attachments();
SELECT rebuild_taxa();
```

**Variants:**

- *Without CHECKs / FKs:* drop the constraints on the five derived tables whose definition
  calls `permid_is_valid` (`contype = 'c'`), then those with `confrelid = 'permids'::regclass`
  (`contype = 'f'`), generated from `pg_constraint`.
- *`COLLATE "C"`:* in one transaction, save the definitions of every constraint and
  standalone index that uses a `permid_no` column (`pg_get_constraintdef`,
  `pg_get_indexdef`), then drop the 17 `permid_no` columns with `CASCADE`, run
  `ALTER COLUMN … TYPE text COLLATE "C"` on all 41 public `*permid` text columns, re-add
  `permid_no bigint GENERATED ALWAYS AS (split_part(permid, '-', 2)::bigint) STORED` to each
  table, recreate the saved definitions, and `ANALYZE`. (PG16 refuses to change a column a
  generated column depends on, hence the drop and re-add.)
- *UUID baseline:* the same run on a copy of `pbdb_pre_permids`.
- *B only, A + B (10-30):* the same run on a copy of a full `--createdb` build, without and
  with the `COLLATE "C"` declarations.

**Seeded paths** (`collate-c-permids`, on the A + B build). The derive functions' seeded
paths run nowhere in the rebuild, so they were checked directly: a seed set of every
`cycle_cuts.cycle_members` element plus 1,000 other taxa permids (1,056 in all), then for
each of `derive_linnaean`, `derive_taxa_clades` and `derive_taxa`:

```sql
CREATE TEMP TABLE full_rows AS SELECT * FROM derive_taxa(NULL);
CREATE TEMP TABLE seed_rows AS SELECT * FROM derive_taxa(:seed);
SELECT * FROM seed_rows
EXCEPT SELECT * FROM full_rows WHERE permid IN (SELECT permid FROM seed_rows);
SELECT * FROM full_rows WHERE permid = ANY (:seed) OR permid IN (SELECT permid FROM seed_rows)
EXCEPT SELECT * FROM seed_rows;
```

Both directions were empty for all three, and no call raised a collation error.

**Micro-benchmarks** (§3, §6) ran on `pbdb` with `max_parallel_workers_per_gather = 0`.
Expressions such as `permid || ''` keep the planner from answering a sort from the unique
index.

## 9. Open questions

- Do A, B and C add up? A + B: 396–421 s, about what A alone gave (§5). A + B + C is
  still to be measured before deciding C.
- How much of the 53 s does B recover? Answered: little (§5). The function itself is 4.6
  times cheaper; why that barely shows in the rebuild is not known.
- What is the unattributed ~22 s?
- How large are the partial re-derivations an opinion write will trigger, and do the
  per-row costs matter at that size? That depends on the write-path design.
- Aurora's taxa step went from 548 s to 739 s (+35%), a smaller relative increase than
  localhost's. Not investigated; Aurora's database collation was not checked. With A, the
  permid columns are `"C"` whatever the default, so it matters less; it is to be checked
  at the next Aurora rebuild.
