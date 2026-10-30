## 1. Baseline

- [ ] 1.1 Record the current localhost state for comparison: per-table counts and the runner's step times from the last full run (`migrations/src/run-migrations.log`, 2026-10-29), and the §5 profile numbers of `docs/permid-rebuild-performance.md` (TXN, as is: 539 s)

## 2. The CHECK function (`db/02-core.sql`, design decision 4)

- [ ] 2.1 Add `permid_prefix_digits(prefix)`: `LANGUAGE sql IMMUTABLE PARALLEL SAFE`, a `CASE` over the 14 prefixes returning each one's digit string (A = 10 … Z = 35), whose `ELSE` calls a small PL/pgSQL function that raises `unknown permid prefix %`. NULL prefix raises too, as today
- [ ] 2.2 Make `permid_check_prefix` and `permid_check_digits` use `permid_prefix_digits`, so the prefix list exists once
- [ ] 2.3 Rewrite `permid_is_valid(value, prefix)` as one `LANGUAGE sql IMMUTABLE PARALLEL SAFE` expression, not `STRICT`: the format regex `AND` the check digits from `permid_prefix_digits(prefix)`
- [ ] 2.4 Confirm on localhost (transaction, rolled back): `EXPLAIN VERBOSE` of a literal-prefix call shows the inlined, folded expression; the new function agrees with the old on every permid in `taxa` and the spec's fixed values (`COL-12345-70`, `COL-012345-70`, NULL, `TXL-1-00`)

## 3. `cycle_members` by number (`db/03-taxa.sql`, design decision 6)

- [ ] 3.1 Replace the five `array_agg(DISTINCT … concept_permid)` that fill `cycle_members` (`derive_linnaean` full and seeded, `derive_taxa_clades`, `derive_taxa` full and seeded) with an aggregate ordered by `split_part(…, '-', 2)::bigint` over a `DISTINCT` subquery
- [ ] 3.2 Run root `npm test`

## 4. Baseline build, without the collation

- [ ] 4.1 Rebuild localhost `pbdb` from empty with the full runner (`--createdb`), with groups 2 and 3 applied and the permid columns still default-collated. All eleven steps pass, and counts match 1.1
- [ ] 4.2 Save the result as `pbdb_collate_baseline` (`CREATE DATABASE … TEMPLATE pbdb`, nothing connected to `pbdb`). Kept until 6.2 is done
- [ ] 4.3 Profile the taxa rebuild on a throwaway copy, as in §8 of the performance document. This is "B only"

## 5. `COLLATE "C"` (`db/02-core.sql`, `db/03-taxa.sql`, design decision 1)

- [ ] 5.1 Declare the 40 permid columns `text COLLATE "C"` (every column the `prefixed-permids` requirement lists; `permids.permid` already is)
- [ ] 5.2 Run root `npm test`

## 6. Build with the collation, and verify

- [ ] 6.1 Rebuild localhost `pbdb` from empty with the full runner. All eleven steps pass, counts match 4.1, and every public `*permid` text column has `collation_name = 'C'`
- [ ] 6.2 Compare `taxa_linnaean`, `taxa_clades`, `taxa_attachments`, `taxa` and `cycle_cuts` with `pbdb_collate_baseline`, every column except `id` and `created_at`. Export each table sorted (by `permid_no`; `cycle_cuts` by every compared column) from both databases and diff. They must be identical. A difference in `taxa` or `cycle_cuts` is a counterexample to design decision 5: stop, record it, and add the walk-start `ORDER BY`
- [ ] 6.3 Seeded paths: build a seed set from every `cycle_cuts.cycle_members` element plus a sample of 1,000 other taxa permids. For `derive_linnaean`, `derive_taxa_clades` and `derive_taxa`, compare the seeded call with the matching rows of the unseeded call, `EXCEPT` in both directions. Both are empty, and no call raises a collation error
- [ ] 6.4 `EXPLAIN` a permid lookup with a parameter (`taxa WHERE permid = $1`) and confirm it uses the unique index
- [ ] 6.5 Run the API integration suite (`npm run test:integration`)
- [ ] 6.6 Profile the taxa rebuild on a throwaway copy (§8). This is "A + B"
- [ ] 6.7 Drop `pbdb_collate_baseline` and the throwaway copies

## 7. Docs

- [ ] 7.1 `docs/permid-rebuild-performance.md`: add the "B only" and "A + B" rows to §5 and the runner step times to §4; mark A and B as adopted in §7; replace the §7 analysis of the walk start with design decision 5 (the cut order can't change the result); add the seeded-path check to §8; answer the §9 questions that A + B settle, and keep C, the ~22 s and Aurora's collation open
- [ ] 7.2 Replace the comment above the cycle-breaking loop in `derive_taxa` ("only which edge gets cut first … can differ") with the reason the order doesn't matter, in a sentence, pointing to the performance document

## 8. Rollback check

- [ ] 8.1 Confirm the change is rebuild-only: no step converts data, so rollback is a revert and a rebuild. The 4.1 build already ran the runner on DDL without the collation, so no separate rollback build is needed
