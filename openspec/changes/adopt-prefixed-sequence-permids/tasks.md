## 1. Baseline

- [x] 1.1 Record the baseline from the current localhost `pbdb`: row counts for every table the runner asserts (from the last full run in `migrations/src/run-migrations.log`), the `taxa` step's tables (`taxa_linnaean` 525,805, `taxa_clades` 3,346, `taxa_attachments` 20,264, `taxa` 525,805), and each step's duration. Save to the scratchpad to compare against in group 6
- [x] 1.2 Confirm the last full run's totals match `openspec/specs/migration-runner` and the memory record. Note any drift before changing anything, so it isn't blamed on this change

## 2. Registry and permid functions (`db/02-core.sql`)

- [x] 2.1 Add the `permids` registry (`permid text COLLATE "C" PRIMARY KEY`, `created_at timestamptz NOT NULL DEFAULT now()`) ahead of every table that references it
- [x] 2.2 Add one sequence per mintable prefix (`REF PRS COL SPM INT TSC AUT NOP AOP VOP TAN SCH CHR STA`), each `START WITH 1000000`
- [x] 2.3 Add the one implementation of MOD 97-10: a function that formats `(prefix, number)` as `<PREFIX>-<number>-<CC>`, and `permid_is_valid(value, prefix)` for the CHECKs. Both refuse unknown and reserved (`TXL`, `TXC`) prefixes
- [x] 2.4 Add `register_permids(prefix, bigint[]) RETURNS text[]`: refuse unknown or reserved prefixes, numbers < 1 or ≥ 1,000,000, duplicates within the call, and already-registered permids. All-or-nothing, results in input order
- [x] 2.5 Add `mint_permids(prefix, n) RETURNS text[]`: take `n` values from the prefix's sequence, register them, return in sequence order
- [x] 2.6 Add SQL-level tests for 2.3–2.5 that run under `npm run test:integration`, covering every scenario in `prefixed-permids` for format, prefixes, register and mint (`COL-12345-70`, `REF-12345-15`, `REF-12345-70` invalid, `COL-12354-70` invalid, leading zero, `XYZ`/`TXL` refused, floor refused, double registration, first `SCH` mint is `SCH-1000000-26`, a 5,000-row batch)

## 3. Permid columns (`db/02-core.sql`, `db/03-taxa.sql`)

- [x] 3.1 In `02-core.sql`, change every own `permid` column (refs, persons, collections, specimens, intervals, timescales, authorities, the three opinion tables, taxon_annotations, schemas, characters, states) to `text NOT NULL`, with an FK to `permids`, a `permid_is_valid(permid, '<PREFIX>')` CHECK, and `permid_no bigint GENERATED ALWAYS AS (split_part(permid, '-', 2)::bigint) STORED`. Remove the version-7 CHECKs
- [x] 3.2 On versioned tables, add a unique index on `permid_no` WHERE `succeeded_by_id IS NULL`. On `persons`, keep `permid` `UNIQUE`
- [x] 3.3 Change every reference column (`subject_permid`, `target_permid`, `containing_permid`, `taxon_annotations.subject_permid`, `homonyms.permid`, `specimens.name_opinions_permid`) to `text`, with an FK to `permids` and a `NOP` CHECK. Keep `homonyms.homonym_group_id` as `uuid` with its version-7 CHECK
- [x] 3.4 Check that `place_in_lineage()`, `install_version_triggers` and the head indexes on `(permid)` still work with `text` permids. Update any `uuid`-typed variables in them
- [x] 3.5 In `03-taxa.sql`, convert every permid column of `taxa_linnaean`, `taxa_clades`, `taxa_attachments`, `taxa` and `cycle_cuts` to `text` with the `NOP` CHECK and an FK to `permids`, and replace the version-7 CHECKs
- [x] 3.6 In `03-taxa.sql`, convert the derive and rebuild functions (`derive_taxa`, `derive_linnaean`, `derive_taxa_clades`, `rebuild_taxa_full` and their helpers): uuid temp-table columns, `uuid[]` parameters and `::uuid` casts all become `text`. `grep -n uuid db/03-taxa.sql` finds only the `homonym_group_id` mentions, if any
- [x] 3.7 Build `classification_path` from the permids as stored, without the `-`↔`_` swap, and update the comment that explains the swap
- [x] 3.8 Update the DDL comments that describe permids as UUIDv7 (including the convention note near `db/02-core.sql:385`)
- [x] 3.9 Apply all three DDL files to an empty database and confirm they load. Run the `db/tests` layout guard

## 4. Migrations (`migrations/src`)

- [x] 4.1 Add `src/lib/permids.js` with batched wrappers for `register_permids` and `mint_permids` (one call per batch, and the call runs on the script's transaction client where the script has one)
- [x] 4.2 `persons`: register `PRS` from `person_no`
- [x] 4.3 `pbot-persons`: mint `PRS` for unmatched PBot persons. Update the comment about `pbotID`
- [x] 4.4 `refs`: register `REF` from `reference_no`, only for rows the run newly inserts, so a re-run doesn't try to register twice
- [x] 4.5 `pbot-refs`: mint `REF` for new rows only. Update the comments that say the permid is a fresh UUIDv7 each run
- [x] 4.6 `pbot-schemas`: mint `SCH`, `CHR` and `STA`
- [x] 4.7 `authorities`: register `AUT` from each survivor's `taxon_no` (the lowest it absorbed). Confirm `legacyIDs.oldpbdbIDs` is unchanged
- [x] 4.8 `authority-opinions`: register `NOP` from each source row's own `taxon_no`, and store it as both `permid` and `subject_permid`
- [x] 4.9 `opinions`: mint `NOP` for concept, misspelling, backfilled and lineage `name_opinions` rows, and `AOP` and `VOP` for assignment and validity opinions. Every `subject_permid`, `target_permid` and `containing_permid` it writes must already be registered
- [x] 4.10 `collections`: register `COL` from `collection_no`
- [x] 4.11 `specimens`: register `SPM` from `specimen_no`. Its `name_opinions_permid` map now holds `NOP` text
- [x] 4.12 Delete `src/lib/uuidv7.js`, drop `uuid` from `migrations/package.json`, and update `package-lock.json`. `grep -rn uuidv7 migrations/src` finds nothing
- [x] 4.13 Update `audit-payloads.js` and its tests where they assume UUID permids, and the runner's preconditions and postconditions where they do
- [x] 4.14 Check whether `payloadSchemas` codecs (`referencePermid`, reference links) or their tests assume UUID-shaped permids. Update fixtures to the new form. Run the root `npm test`

## 5. API (`api/`)

- [x] 5.1 `src/lib/repository.js`: order lists by `permid_no` and seek on `permid_no`. The cursor still carries the permid text. Decode it to its number, and answer 400 when the decoded permid isn't well-formed. Update the comment on the ordering contract
- [x] 5.2 `src/lib/taxa-repository.js`: the same for taxa (`t.permid_no`). Update the comment that calls the order "UUIDv7, i.e. rebuild insertion order"
- [x] 5.3 `src/lib/classification-path.js`: remove `labelToPermid`'s swap and the "two traps" note about hyphens. Update `test/classification-path.test.js`
- [x] 5.4 Check `src/lib/cursor.js`, `query-schemas.js` and `list-filters.js` for UUID assumptions (patterns, lengths)
- [x] 5.5 `test/integration/helpers.js`: replace `newPermid()` with minting through `mint_permids`, and update `reads.test.js`, `taxa.test.js`, `reference-filters.test.js` and `reference-type-filters.test.js`
- [x] 5.6 Add a unit or integration test that a list orders `…-99-…` before `…-100-…`, and that paging through yields every record exactly once
- [x] 5.7 Update unit-test fixtures that use UUID-shaped permids, where the shape matters to the test. Run `npm test` in `api/` and `npm run test:integration`

## 6. Rebuild and verify

- [x] 6.1 Rebuild localhost `pbdb` from empty with the full runner (`--createdb`). All eleven steps pass their assertions
- [x] 6.2 Compare every table count with the baseline (1.1). Investigate any difference, including FK failures that expose orphans the old schema accepted. Fix the cause; don't drop the FK
- [x] 6.3 Spot-check the numbering against the specs: `COL-12345-70`, `PRS-42-70`, `AUT-526271-06` and `NOP-526271-71` exist. A merged authority's permid uses its lowest `taxon_no`. No legacy number is ≥ 1,000,000. Every sequence-numbered permid is ≥ 1,000,000
- [x] 6.4 Check that every registry row is used by exactly one entity (no orphan registry rows, no head without a registry row)
- [x] 6.5 Rebuild a second time and diff the legacy-numbered permids (`permid_no < 1000000`) with the first build. They must be identical
- [x] 6.6 Run the payload audit with `--round-trip`. It shows zero differences
- [x] 6.7 Compare step durations with the baseline. If the `taxa` step or any bulk step is much slower (registry FKs, batched minting), record why and decide whether it matters
- [ ] 6.8 Rebuild Aurora `pbdb2_migration_test` (VM on VPN) and confirm the counts match localhost
- [x] 6.9 Rollback check: rebuilding from the previous branch's DDL and runner still works (the change is rebuild-only, no conversion)

## 7. Docs and config

- [x] 7.1 `docs/api-design-backlog.md`: mark "Human-facing identifiers" as decided and point to this change. Fix the example to `COL-12345-70`. Record the decisions taken here that the backlog doesn't have (prefix table, floor 1,000,000, no runner step, SQL-only check digits)
- [x] 7.2 `openspec/config.yaml`: replace `permid-uuidv7` in the migration-spec path list. `prefixed-permids` is a repository-root spec
- [x] 7.3 `api/docs/taxa-classification-reads.md`: update the identity row ("uuid v7") and the ltree underscore round-trip note
- [x] 7.4 Check `api/CLAUDE.md`, `README.md` and `migrations/src/README.txt` for statements about UUID permids. Leave historical analysis docs (`docs/classic-taxa-opinions.md`, `docs/taxa-opinions-migration-mapping.md`) alone unless they describe current behaviour
- [x] 7.5 Run `openspec validate adopt-prefixed-sequence-permids --strict`

## 8. Rename the name_opinions prefix `NOP` → `TXN` (design decision 20)

Groups 2–7 above say `NOP`; they record what was done before the rename. Task 6.8 (Aurora) waits for this group.

- [ ] 8.1 `db/02-core.sql`: replace `NOP` with `TXN` in `permid_check_prefix`'s list, rename `permid_nop_seq` to `permid_txn_seq` (still `START WITH 1000000`), and update every `permid_is_valid(…, 'NOP')` CHECK and the prefix comment block. Remove the `TXL`/`TXC` reservation from `permid_check_prefix` and the comment, so both become ordinary unknown prefixes
- [ ] 8.2 `db/03-taxa.sql`: replace the `NOP` CHECKs on `taxa_linnaean`, `taxa_clades`, `taxa_attachments`, `taxa` and `cycle_cuts`, and the `NOP` mentions in comments. `grep -n "\bNOP\b" db/` finds nothing (`CONOP` in `01-dictionaries.sql` is unrelated)
- [ ] 8.3 Update the SQL-level permid tests (2.6): the reserved-prefix case becomes `NOP` and `TXL` refused as unknown, and any `NOP` example uses `TXN` with digits from `format_permid`
- [ ] 8.4 `migrations/src`: `'NOP'` → `'TXN'` in `authority-opinions-migration/migrate-authority-opinions.js` (register) and `opinions-migration/migrate-opinions.js` (mint), and in their comments and the opinions migration docs where they describe current behaviour
- [ ] 8.5 `api/`: update `src/lib/taxa-repository.js` and `src/lib/classification-path.js` comments, `test/classification-path.test.js`, `test/taxa.test.js`, `test/integration/taxa.test.js` and `docs/taxa-classification-reads.md`. Expected permids change their check digits too (`NOP-526272-68` → `TXN-526272-71`); take new values from `format_permid`, never by hand
- [ ] 8.6 `docs/api-design-backlog.md`: update the prefix record (line ~771: `TXN` for name opinions, no reserved prefixes). Add an open API design entry for the resolver rule for a bare `TXN` permid (taxon if one exists, else the opinion) and for documenting that only a root opinion's permid is also a taxon. Note that `TXN-n` is not promised to equal Classic `txn:n` (Classic's `orig_no` vs our `taxon_no`, unverified)
- [ ] 8.7 Run the root `npm test`, `npm run test:integration` and the `db/tests` layout guard. `grep -rnw NOP --exclude-dir=node_modules --exclude-dir=archive --exclude-dir=migration_exploration .` finds only historical text (design.md decisions 17 and 20, tasks groups 2–7) and generated logs
- [ ] 8.8 Rebuild localhost `pbdb` with the full runner (`--createdb`) and the taxa step. Counts match the 6.1 rebuild exactly. Spot-check `TXN-526271-74` (root opinion and taxon) next to `AUT-526271-06`, and that no `NOP-…` permid exists in `permids`
- [ ] 8.9 Re-run the 2026-10-29 check: every `taxa` and `taxa_linnaean` permid equals a live root `name_opinions` permid, root rows have `permid = subject_permid`, and no non-root opinion's permid is a taxon
- [ ] 8.10 Run `openspec validate adopt-prefixed-sequence-permids --strict`
