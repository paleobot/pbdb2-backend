## 1. Source lists and counts

- [ ] 1.1 Regenerate `docs/occurrences-excluded.csv` against `pbdb_2026_10_18` and the PostgreSQL collections: 626 occurrences + 15 reidentifications, same columns as today, keeping the existing categories and adding one for collection 27182 (in Classic, not migrated). Record the generating query in `occurrences.md`
- [ ] 1.2 Find out from the collections migration (its anomaly log and source filters) why collection 27182 was not migrated, and note the cause in `occurrences.md`; no fix in this change
- [ ] 1.3 Regenerate `docs/occurrences-collection-conflicts.csv` (12 rows), same columns, and record its query
- [ ] 1.4 Replace the mirror figures in `occurrences.md` with the `pbdb_2026_10_18` ones (source totals, exclusions, reference fallbacks 13 / 0, unset and orphan taxa, abundances, targets table)

## 2. Payload builders

- [ ] 2.1 Create `src/occurrences-migration/migrate-occurrences.js` with exported `isUnset`, `buildIdentificationPayload(src, {reid})` and `buildAbundancePayload(src)`, and the invoked-directly guard so tests can import them
- [ ] 2.2 Add `src/tests/occurrences-transforms.test.js`: `''`/NULL keys omitted, a rank with neither omitted, `"` kept, `plant_organ` then `plant_organ2`, reidentification `legacyIDs`, NUL bytes stripped, unit-only abundance, and every built fixture valid against both `db` variants
- [ ] 2.3 `npm test` passes

## 3. Load

- [ ] 3.1 Setup: `--dry-run`, lookup maps (refs, `loadNamePermidMap`, collections → id and `reference_id`), `db` validators for both sources, anomaly log
- [ ] 3.2 Pass 1: stream occurrences by `occurrence_no`; exclude by PostgreSQL collection; resolve persons, reference (collection fallback), taxon (orphan → NULL + anomaly); per batch `registerPermids('OCC')`, insert roots, `mintPermids('ABD')`, insert abundances; remember loaded occurrence numbers and each root's `reference_id`
- [ ] 3.3 Pass 2: stream reidentifications by `reid_no`; exclude when the occurrence was not loaded; log collection conflicts; per batch `mintPermids('OCC')`, `occurrence_permid` from `format_permid('OCC', …)` in SQL, reference fallback to the root's, insert non-roots
- [ ] 3.4 Before COMMIT: compare excluded and conflict sets with the two CSVs, assert the four counts, call `rebuild_occurrences()` and assert `occurrences` = roots; ROLLBACK on any failure or under `--dry-run`
- [ ] 3.5 Final report: source counts, rows per table, exclusions by category, conflicts, fallbacks, unset/orphan taxa, persons sentinel, anomalies, elapsed time

## 4. Runner and audit

- [ ] 4.1 Add step `occurrences` (row 12) to `src/run-migrations.js` with its env, writes, first-writer tables and preconditions
- [ ] 4.2 Add `identification` (`identifications.identification`) and `occurrence-abundance` (`occurrence_abundances.abundance`), both versioned, `columns: ['permid']`, to the registry in `src/audit-payloads.js`
- [ ] 4.3 Update `src/tests/run-migrations-audit.test.js` for the new step and entities, and the step table in `src/README.txt`
- [ ] 4.4 `npm test` passes

## 5. Verify on localhost

- [ ] 5.1 Ask whether to keep the current `pbdb` as a backup database, then rebuild localhost `pbdb` with a full `--createdb` run at the working tree (the new DDL is needed anyway); record the step's time, the transaction's commit time and peak memory
- [ ] 5.2 Check counts against the spec: roots, non-roots, abundances, derived `occurrences`, exclusions; `count(DISTINCT created_at)` = 1 on `identifications`; first minted permids `OCC-10000000-29` and `ABD-10000000-93`; registry rows by prefix and table size
- [ ] 5.3 Compare derived winners with Classic's `setMostRecentReID` rule over the dump: expect a reidentification winner identical to Classic's rule everywhere it wins, 775 original wins, and the 17 stale `YES` flags corrected
- [ ] 5.4 Run `audit-payloads.js --entity identification --entity occurrence-abundance --round-trip`: zero violations, zero differences
- [ ] 5.5 Rollback check: run the step with `--dry-run` against a database without occurrence rows and confirm `identifications`, `occurrence_abundances`, `occurrences` and the `OCC`/`ABD` registry rows are unchanged
- [ ] 5.6 Determinism: dump the `(permid, oldpbdb_occurrence_no, oldpbdb_reid_no)` of `identifications` and the abundance permids, rebuild once more, and diff

## 6. Aurora and records

- [ ] 6.1 With the user's go-ahead and the VPN up, rebuild Aurora `pbdb2_migration_test` at the implementation commit; compare counts and permids with localhost and record the step time
- [ ] 6.2 Record in `occurrences.md` the measured counts, runtime, registry growth and `rebuild_occurrences()` time on both databases
- [ ] 6.3 `openspec validate create-occurrences-migration --strict`
