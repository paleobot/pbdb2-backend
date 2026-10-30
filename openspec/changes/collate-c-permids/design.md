## Context

`adopt-prefixed-sequence-permids` made every permid a `text` value `<PREFIX>-<number>-<CC>`.
`docs/permid-rebuild-performance.md` measured what that cost in bulk writes (2026-10-29): a full
taxa rebuild takes 539 s against 315 s with UUIDs. Two of its causes have cheap fixes:

- **Collation (about 118 s).** Permid columns use the database default, `en_US.UTF-8`, so every
  sort, window partition, merge join, temp-table index and `min()` over permids is a locale-aware
  comparison. The `permids` registry is already `COLLATE "C"` (that change's decision 4); the
  columns that reference it are not.
- **The CHECK function (53 s on the derived tables).** `permid_is_valid` is PL/pgSQL. Each call runs
  `permid_check_prefix`, a regex, and `permid_check_digits`, which rebuilds the prefix's digit
  string with `string_agg` over `unnest`. That is about 4.5 µs per value, and the derived tables
  carry 18 such CHECKs.

§7 of the same document lists where ordering on permid text could reach stored output. Only one
place does: `cycle_cuts.cycle_members`, built with `array_agg(DISTINCT concept_permid)` and so in
text order.

Every database is built from the DDL; there is no in-place migration path to maintain.

## Goals / Non-Goals

**Goals:**

- Permid comparisons are bytewise everywhere a permid is stored.
- The permid CHECK is cheap enough that the derived tables' CHECKs no longer dominate a rebuild.
- No stored output depends on the collation, and the change is proven to alter none.
- The performance document records what A and B recover together.

**Non-Goals:**

- Option C (dropping the CHECKs and FKs on the derived tables). It is decided after this change's
  numbers are in.
- The walk start in `derive_taxa`'s cycle loop (`FROM _dtu_peel p LIMIT 1`, no `ORDER BY`). The cut
  order it picks is not visible in any output (decision 5).
- Text declared inside the derive functions (plpgsql variables, explicitly declared temp tables such
  as `_dtu_walk_path`, the `seed text[]` parameter). It keeps the default collation; see decision 2.
- The database default collation. Changing it would need a new cluster or `CREATE DATABASE …
  LOCALE`, affects every text column, and isn't needed.
- Aurora's collation (§9 of the performance document). Checked when Aurora is next rebuilt.

## Decisions

1\. **Each permid column is declared `text COLLATE "C"`,** in `db/02-core.sql` and `db/03-taxa.sql`,
the same way the registry already is. That is every column the `prefixed-permids` requirement "Every
permid column is text, checked, and a foreign key to the registry" lists. That is 40 columns; with
`permids.permid` they are the 41 public `*permid` text columns the measured variant changed.
*Alternative: a domain* (`CREATE DOMAIN permid AS text COLLATE "C"`). It would state the collation
once, but it changes the column's type name for every client and catalog query and adds one more
object; 40 short edits match how the registry is declared. *Alternative: change the database
collation.* See Non-Goals.

2\. **Mixed collations are left to PostgreSQL's rules.** When a `"C"` column meets default-collated
text (a function parameter, a plpgsql variable, a declared temp-table column, `->>` from a payload),
the result is `"C"`: an implicit non-default collation wins over the default. There is no error unless
two *different* non-default collations meet, and nothing declares one. The one construct that can
fail is a recursive CTE whose anchor and recursive terms end up with different collations; all 11 in
`db/03-taxa.sql` start from columns (`seed` is only used in `= ANY(seed)` filters), so none should.
The seeded-path check in decision 7 is what proves it, since the 118 s measurement ran only the full
rebuild. The few explicitly declared text temp-table columns stay default; they are small and only
compared for equality.

3\. **This does not reopen the ordering decision.** `adopt-prefixed-sequence-permids` decision 3
rejected "plain `C` collation on the text" as the way to *order* permids, because `"C"` sorts
`TXN-100-…` before `TXN-99-…`. That still holds: lists, pagination and tie-breaks order by
`permid_no` or `split_part(permid, '-', 2)::bigint`. `"C"` is chosen here for comparison cost only.
Neither collation gives numeric order, so nothing that relied on text order is lost.

4\. **`permid_is_valid` becomes a plain SQL function that the planner inlines.** The prefix's digit
string (A = 10 … Z = 35, so `TXN` is `293323`) comes from a new SQL function,
`permid_prefix_digits(prefix)`, a `CASE` over the 14 prefixes whose `ELSE` calls a small PL/pgSQL
function that raises `unknown permid prefix`. `permid_is_valid` is then one expression: the
format regex `AND` the check digits computed from `permid_prefix_digits(prefix)`.

It is declared `IMMUTABLE PARALLEL SAFE` but **not `STRICT`**. PostgreSQL does not inline a strict
SQL function whose body contains a non-strict construct such as `CASE`. The expression already yields
NULL for a NULL value, so a nullable column's CHECK behaves as it does today.

Inlined into a CHECK with a literal prefix, the `CASE` and the regex fold to constants. A test
(2026-10-30, rolled back, `pg_temp` copies) showed the folded plan and gave these timings:

| 525,805 TXN values | PL/pgSQL today | inlined SQL | no check |
|---|---|---|---|
| in a `SELECT` | 3.94 s | 0.69 s | 0.04 s |
| as a CHECK, `INSERT` into a temp table | 4.21 s | 0.83 s | 0.11 s |

It also found no result differences across all 525,805 taxa permids and the edge cases (bad check
digits, leading zero, wrong prefix, NULL, junk), and an unknown prefix raised on insert, as it does
today.

`permid_prefix_digits` becomes the one list of prefixes. `permid_check_prefix` (used by
`format_permid`, `register_permids`, `mint_permids`) and `permid_check_digits` both use it, so the
list is not kept twice. The error message stays the same; `api/test/integration/permids.test.js`
matches on it.
*Alternative: integer arithmetic instead of `numeric % 97`.* What is left per value is mostly the
`numeric` cast and modulo. A bigint version needs `10^len(number) mod 97` and is harder to read;
not worth it before C is decided.

5\. **The cycle-cut order is left alone, because it can't change the result.** `_dtu_node` gives each
concept exactly one container, so the containment graph is functional and its cycles never share a
node. Cutting one cycle's weakest edge changes only that node's own edge. Its replacement is its
next-best assignment, which depends only on its own opinions and the excluded set. Every other
cycle is still there with the same weakest edge, so two cuts give the same state in either order.
The loop always terminates, so by Newman's lemma every order ends at the same set of cuts, and
each logged cycle has the same members. The comment in `derive_taxa` ("only which edge gets cut
first … can differ") was right; §7 of the performance document, which called this a possible
taxonomy change, is corrected. The same argument covers the seeded path's loop over
`_dtu_seed_con_reps`, which also has no `ORDER BY`.

6\. **`cycle_members` is sorted by permid number.** The five `array_agg(DISTINCT concept_permid)`
sites (`derive_linnaean` and `derive_taxa`, full and seeded paths; `derive_taxa_clades`) become an
aggregate ordered by `split_part(…, '-', 2)::bigint` over a `DISTINCT` subquery. With `DISTINCT`,
an aggregate's `ORDER BY` can only be the aggregated value itself, hence the subquery. This
matches decision 17 of `adopt-prefixed-sequence-permids`, and it is what the new `prefixed-permids`
requirement asks for: no ordering on permid text reaches stored output.

7\. **Verification compares two full builds and checks the seeded paths directly.**
- *Collation diff.* Build `pbdb` from the DDL with decisions 4 and 6 but with the `"C"` declarations
  left out, save the five derived tables, then build again with everything. Compare
  `taxa_linnaean`, `taxa_clades`, `taxa_attachments`, `taxa` and `cycle_cuts` row for row, leaving
  out generated ids and timestamps. They must match exactly. Any difference is a bug, and also a
  counterexample to decision 5.
- *Seeded paths.* On the final build, call `derive_linnaean`, `derive_taxa_clades` and `derive_taxa`
  with a seed set that includes every `cycle_cuts` member plus a sample of ordinary taxa, and compare
  each result with the same rows of the unseeded call. The only tool for this,
  `migration_exploration/testing/diff-derive-taxa-seed.js`, is UUID-era and superseded, so the
  comparison is a short SQL `EXCEPT` in each direction, kept in the performance document's method
  section rather than as a new script.
- *Timings.* Profile the taxa rebuild as in §8 of the performance document, and record the runner's
  step times. Both go in the document, with the §5 table extended and the §9 questions on A + B
  answered.

## Risks / Trade-offs

- [A permid query loses its index, because it compares under a different collation than the
  index] → Only an explicit `COLLATE` on the query side could cause this, and nothing writes one.
  Default-collated parameters combine to `"C"` and use the new indexes. The API integration suite
  and an `EXPLAIN` on a permid lookup confirm it.
- [Decision 5's argument is wrong] → The collation diff in decision 7 would show it as a difference
  in `taxa` or `cycle_cuts`. The change then adds the walk-start `ORDER BY` it currently leaves out.
- [The seeded paths fail under `"C"`, for example a recursive-CTE collation mismatch] → Decision 7's
  seeded check runs every derive function with a seed. A failure is fixed by declaring the
  offending temp-table column or cast `COLLATE "C"`.
- [The inlined CHECK raises at a different moment for an unknown prefix] → Both versions raise when
  the CHECK is first evaluated, not at `CREATE TABLE`. The test above confirmed it, and only the
  DDL's literal prefixes reach these CHECKs.
- [Aurora's default collation differs from localhost] → Explicit `COLLATE "C"` columns behave the
  same whatever the default, so the change makes the two environments more alike, not less.

## Migration Plan

1. Change the DDL and functions as above; run root `npm test`.
2. Build localhost twice for the collation diff (decision 7); the second build is the one kept.
   Run the API integration suite against it.
3. Profile the taxa rebuild and update `docs/permid-rebuild-performance.md`.
4. Aurora is rebuilt from the same DDL with the next dev deploy, as with the previous change.

Rollback is a revert of the change and a rebuild. There is no data to convert either way.

## Open Questions

- Do A + B approach the ~335 s that §5 of the performance document estimates? The answer decides
  how much option C is still worth.
- Aurora's default collation: checked at the next Aurora rebuild, since this change makes it matter
  less.
