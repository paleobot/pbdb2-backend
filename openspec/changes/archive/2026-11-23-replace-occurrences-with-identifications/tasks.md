## 1. Settle the design (done in explore mode, 2026-11-23)

- [x] 1.1 Identification-as-opinion model, root-only collection, permid = root permid (design D1–D3)
- [x] 1.2 Winner ranked by latest reference, lineage first-entry time as tie-break; measured against entry order (D4)
- [x] 1.3 Removed-root rule, derived-row shape with the winning name, plant-organ inheritance (D5, D6, D8)
- [x] 1.4 `occurrence_abundances` as its own table, one head per occurrence (D7)
- [x] 1.5 Supersession of the archived `create-occurrences-schema` decisions (D10)

## 2. Schema (db/)

- [x] 2.1 Replace the `occurrences` DDL in `db/02-core.sql` with `identifications`: columns, version triggers, `occurrence_permid`/collection shape CHECK, head-only indexes on `occurrence_permid` and `taxon_permid`, index on `oldpbdb_occurrence_no`
- [x] 2.2 Add `occurrence_abundances` to `db/02-core.sql`: versioned, unique head per `occurrence_permid`, no FK on `occurrence_permid`
- [x] 2.3 Add the derived `occurrences` cache where the DDL-layout guard allows (after the tables it reads): plain table, `permid` UNIQUE, `identification` jsonb, `plant_organs`, `winning_identification_id`, plain indexes on `taxon_permid` and `collection_id`, index on `oldpbdb_occurrence_no`
- [x] 2.4 Verify on a scratch database: root and non-root inserts, the shape CHECK rejecting a collection on a non-root and a root without one, a second abundance head rejected, versioning of both tables
- [x] 2.5 Run `db/tests` (DDL-layout guard) and confirm nothing earlier in the layout references a later file

## 3. Derivation

- [x] 3.1 `derive_occurrences(seed uuid[] DEFAULT NULL)`: one row per live root, winner by reference year then lineage first-entry time then lineage first id, NULLS LAST throughout (specs: occurrence-derivation)
- [x] 3.2 Plant-organ inheritance from the highest-ranked identification that has organs
- [x] 3.3 `rebuild_occurrences()`: materialize once, upsert with the `IS DISTINCT FROM` guard, delete orphans explicitly, report changed rows; stable ids
- [x] 3.4 Scenario tests against a scratch database for every scenario in `occurrence-derivation`, including: later reference beats later entry, correcting an old identification leaves the winner unchanged, removed root deletes the cached row, second rebuild is a no-op, a reference-year change changes the winner
- [x] 3.5 Check that a seeded derivation equals the full one for the same permids, and time the full derivation over a synthetic full-size load; figures recorded in design.md D6
- [x] 3.6 Keep `rebuild_occurrences()` a separate entry point (not folded into `rebuild_taxa_full()`, whose return shape other specs fix); the migration runner calls it after reference or identification changes (design Risks)

## 4. Payload schemas

- [x] 4.1 Add `payloadSchemas/identification.schema.js` (names with resolutions, `plantOrgans`, `comments`, `legacyIDs`) and `tests/fixtures/identification-example.json`; no abundance
- [x] 4.2 Add `payloadSchemas/occurrenceAbundance.schema.js` (`value`, `unit`) and its fixture
- [x] 4.3 Remove `payloadSchemas/occurrence.schema.js` and `tests/fixtures/occurrence-example.json`; update `payloadSchemas/tests/sources.test.js` for both new sources and the resolution/ditto/abundance-rejected quirks
- [x] 4.4 Run the payload-schema test suite (the 13–14 real-DB failures that need `PG_*` env vars are pre-existing)

## 5. Mapping document and curator lists

- [x] 5.1 Rewrite `migrations/src/occurrences-migration/docs/occurrences.md`: Classic occurrence → root identification; reidentification → non-root; `abund_value`/`abund_unit` → `occurrence_abundances` (copying the occurrence's persons, reference, `created`; one row per occurrence with a non-empty `abund_value`); the reidentification's own `collection_no` is ignored
- [x] 5.2 Generate `docs/occurrences-collection-conflicts.csv` from the mirror: the 12 reidentifications whose `collection_no` differs from their occurrence's, with both collections, both references, and created dates
- [x] 5.3 Restate the carried-over rules for the migration author (never read `reid_no`/`most_recent`, `0` and NULL are both unset, exclusions, reference fallback, explicit NULL `created_at`) against the new tables; recompute the row targets (1,984,107 + 35,083 = 2,019,190 identifications, 801,900 abundances)
- [x] 5.4 Leave `docs/occurrences-excluded.csv` unchanged; confirm its counts still hold

## 6. Spec housekeeping

- [x] 6.1 `openspec validate replace-occurrences-with-identifications --strict` passes
- [x] 6.2 Sync deltas to the main specs and archive; the new `Purpose` sections replace the placeholder text
- [x] 6.3 Update the occurrences status memory and the user-facing docs that mention `reidentifies_id` or the `occurrence.schema.js` payload

## Handed off (out of scope for this change)

Owned by another team member, in a follow-on change; the findings are in design.md (D3, D4, D7, D10) and the rewritten mapping doc.

- [ ] H.1 `migrations/src/occurrences-migration/migrate-occurrences.js`: stream, resolve, validate, batch-insert roots then non-roots (order no longer affects correctness), then abundances, then call `rebuild_occurrences()`; log the 12 conflicts and the 555 chains where Classic's `most_recent` disagrees with chronology
- [ ] H.2 Runner step with pre/postconditions and `migrations/src/README.txt`
- [ ] H.3 Register the identification and abundance payloads in `migrations/src/audit-payloads.js`
- [ ] H.4 Tests, exclusion-count assertion, and a full-run timing including the derive
- [ ] H.5 A human decides the 6 `collection-lost` rows and the 12 conflicting collections
- [ ] H.6 Decide the ditto-mark expansion (design: Open Questions)
