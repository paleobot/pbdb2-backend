## Why

Since `adopt-prefixed-sequence-permids`, a full taxa rebuild takes 539 s against 315 s with UUIDs,
and every migration step that writes permids is slower. `docs/permid-rebuild-performance.md`
attributes about 118 s of that to the database collation (`en_US.UTF-8`) used for every permid
comparison, and 53 s to the PL/pgSQL `permid_is_valid` CHECK on the derived tables alone. Both are
cheap to fix (options A and B in that document), and the cost will grow once the opinion write path
reruns parts of the derivation on every write.

## What Changes

- Every permid column in `db/02-core.sql` and `db/03-taxa.sql` is declared `text COLLATE "C"`, as
  the `permids` registry already is. Permids are ASCII codes, so the locale ordering bought nothing.
  Equality, and so every join, CHECK and FK, is unchanged. Ordering still uses `permid_no`.
- `permid_is_valid(value, prefix)` becomes a plain SQL function with the prefix's check-digit
  string looked up rather than rebuilt per call, so the planner can inline it into each CHECK and
  fold the per-prefix parts to constants. Its results are unchanged, and an unknown prefix still
  raises.
- `cycle_cuts.cycle_members` is sorted by permid number instead of by text, in the five places
  that build it (`derive_linnaean`, `derive_taxa_clades` and `derive_taxa`, full and seeded paths).
  It was the only derived output whose content depended on the collation.
- Verification: a full build with these changes is compared with the same build under
  `en_US.UTF-8`, across `taxa_linnaean`, `taxa_clades`, `taxa_attachments`, `taxa` and
  `cycle_cuts`. They must be identical. The rebuild is profiled again, and
  `docs/permid-rebuild-performance.md` records the result and corrects §7: the order in which
  `derive_taxa` cuts cycles cannot change the result (the containment graph is functional, so
  simultaneous cycles are disjoint and their cuts commute).
- Not changed: the walk start in `derive_taxa`'s cycle loop (`LIMIT 1` with no `ORDER BY`) stays
  as it is, since its order is not visible in any output. Option C (dropping the CHECKs and FKs on
  the derived tables) stays a separate decision, to be taken after A and B are measured together.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `prefixed-permids`: permid columns are `text COLLATE "C"`. A new requirement: no ordering
  on permid text reaches stored output, so tie-breaks and `cycle_members` use the permid number.

## Impact

- `db/02-core.sql`: permid column definitions, `permid_is_valid`.
- `db/03-taxa.sql`: permid column definitions, the five `cycle_members` aggregates.
- Every database is rebuilt from the DDL. There is no in-place migration, as before: PostgreSQL
  refuses `ALTER COLUMN … TYPE` on a column that a generated column (`permid_no`) depends on.
  Localhost is rebuilt; Aurora is rebuilt with the next dev deploy.
- No API or migration-script changes are expected. Root `npm test` and the API integration suite
  (which covers `permid_is_valid` in `permids.test.js`) must pass unchanged.
- The seeded derive paths (`derive_*(seed)`) run nowhere today: the integration suite inserts
  `taxa` rows directly, and the only seed diff tool
  (`migration_exploration/testing/diff-derive-taxa-seed.js`) is UUID-era and superseded. The 118 s
  measurement covered only the full rebuild. Verification therefore calls each `derive_*` with a
  seed set that includes cycle members, and compares the result with the matching rows of the full
  derive, on the `"C"` build.
- `docs/permid-rebuild-performance.md`: new measurements, the §7 correction, and the open
  questions in §9 that this answers.
