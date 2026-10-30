# Prefixed Permids and Rebuild Performance: Measured Findings

**Status:** Design reference (measured; no change proposed yet)
**Audience:** PBDB2 backend contributors
**Subject:** What the switch from UUIDv7 to prefixed text permids
(`adopt-prefixed-sequence-permids`) cost in bulk write performance, where the cost
comes from, and the options for getting it back

---

## 1. Why this document exists

After `adopt-prefixed-sequence-permids` was applied, the migration runner and the taxa
rebuild were visibly slower than before. This document records the measurements taken on
2026-10-29 so a later decision (fix now, fix with the opinion write path, or accept) can
cite numbers instead of re-deriving them. No change has been created. If one is, its
`design.md` holds the decisions; this document is the evidence.

The short version: **reads are unaffected; bulk writes are slower.** A full taxa rebuild
takes 539 s against 315 s with UUIDs (+71%). About half of that is the database collation
used to compare text permids, and about a third is the per-row CHECK and FK on the derived
taxa tables.

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

| Step | Localhost UUID (10-19) | Localhost text (10-28, 10-28, 10-29) | Aurora UUID (10-20) | Aurora TXN (10-29) |
|---|---|---|---|---|
| persons | 2 | 3, 3, 2 | 106 | 105 |
| refs | 7 | 14, 14, 11 | 42 | 92 |
| pbot-schemas | 6 | 12, 8, 7 | 260 | 387 |
| authorities | 11 | 22, 20, 17 | 38 | 60 |
| authority-opinions | 23 | 55, 52, 45 | 120 | 280 |
| opinions | 39 | 118, 120, 99 | 225 | 539 |
| collections | 36 | 54, 46, 43 | 158 | 323 |
| specimens | 14 | 25, 21, 20 | 50 | 90 |
| taxa (step alone) | 364 (10-21) | 610, 551, 549 | 548 (10-21) | 739 |

The full Aurora run went from roughly 20 to 46 minutes. The 10-19 localhost run predates
the taxa runner step, so its taxa figure is the standalone UUID taxa run from 10-21.

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

"Derived tables" means the five tables above: 18 permid CHECKs and 18 FKs to `permids`.
The collation variant changes every public `*permid` text column, opinion tables included,
and nothing else.

### Where the 224 s goes

```
UUID build                                              315 s
+ permid comparisons under en_US.UTF-8          ~118 s  (measured: collation variant)
+ permid CHECKs on the derived tables             53 s  (measured)
+ registry FKs on the derived tables              31 s  (measured)
+ unexplained                                    ~22 s
= TXN build, as is                                      539 s
```

The parts were measured one at a time. Whether they add up, i.e. whether all three fixes
together reach about 335 s, has not been tested.

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

### 6.3 Registry FKs (31 s on the derived tables)

Each inserted permid value is a separate lookup into the 2.45-million-row `permids` table,
checked row by row by the FK trigger (a batched join of all 525,805 values takes 0.33 s).

### 6.4 Not attributed (about 22 s)

Not measured separately. Candidates: wider rows in the temp tables, and the numeric
tie-break sorts (decision 17).

## 7. Options

| | What | Recovers (taxa rebuild) | Also helps | Cost / trade-off |
|---|---|---|---|---|
| **A** | Declare every permid column `COLLATE "C"` in `db/02-core.sql` and `db/03-taxa.sql` | ~118 s (measured) | migrations, future opinion writes, any permid sort or join | Small DDL edit. PG16 blocks `ALTER TYPE` under a generated column, but the DDL is always rebuilt, so the columns are just declared that way. Needs a full-content diff (see below). |
| **B** | Rewrite `permid_is_valid` as a plain SQL function with precomputed prefix digits | part of 53 s (not measured) | every table's inserts, so all migrations | Small. One function; the SQL permid tests already cover it. |
| **C** | Drop the permid CHECKs and FKs on the derived taxa tables | up to 84 s (measured together) | partial re-derivations on opinion writes | Reverses part of decision 11. The tables are rebuildable caches, every value comes from opinion columns that are already checked, and `assert_*_invariant()` re-checks them. But a derive bug would surface at assert time instead of insert time. |
| **D** | Fewer round trips: batch the per-insert mints in `pbot-persons`/`pbot-schemas`, or register permids in the same statement as the insert | Aurora migration time | Aurora runs only | Script changes. Decision 18 chose per-insert minting because those scripts can't know their rows up front. |
| **E** | Accept | — | — | Costs fall on rebuilds and migrations today. They will matter once the opinion write path exists, since every opinion write reruns part of the derivation. |

A and B are cheap and independent of each other. C is a design decision and is easier to
judge after A and B, when what's left to gain is known.

### Correctness caveat for A

The collation variant's row counts matched, but its contents were not compared. Under
`en_US.UTF-8`, `TXN-100-…` and `TXN-99-…` (and permids generally) sort differently than
under `"C"`, because en_US largely ignores the hyphens. Decision 17 moved the derivation's
tie-breaks to numeric order, but union-find representatives (`min(node)`) still take text
order. Decision 17 calls them internal labels only, but any text ordering on permids that
does reach the output would change. A change adopting A must diff the full contents of
`taxa_linnaean`, `taxa_clades`, `taxa_attachments` and `taxa` against the current build,
not just the counts.

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

**Micro-benchmarks** (§3, §6) ran on `pbdb` with `max_parallel_workers_per_gather = 0`.
Expressions such as `permid || ''` keep the planner from answering a sort from the unique
index.

## 9. Open questions

- Do A, B and C add up? Measure A + B, then A + B + C, before deciding C.
- How much of the 53 s does B recover? Measure `permid_is_valid` before and after on the
  same 525,805 values.
- What is the unattributed ~22 s?
- How large are the partial re-derivations an opinion write will trigger, and do the
  per-row costs matter at that size? That depends on the write-path design.
- Aurora's taxa step went from 548 s to 739 s (+35%), a smaller relative increase than
  localhost's. Not investigated; Aurora's database collation was not checked.
