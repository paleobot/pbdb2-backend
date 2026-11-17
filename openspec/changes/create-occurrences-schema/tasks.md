## 1. Profile the source (Phase 0)

- [x] 1.1 Measure occurrence and reidentification row counts, `0`/NULL splits, orphans, and chain structure on the classic mirror
- [x] 1.2 Establish what the occurrence row represents relative to its reidentifications, and how reliable `reid_no` and `most_recent` are
- [x] 1.3 Check that every foreign key resolves against migrated PostgreSQL data, and find the rows that cannot

## 2. Decide the shape (Phase 1)

- [x] 2.1 Reidentification as a linked occurrence row, no current flag, nullable taxon, payload/column split, versioning (design D1–D5, D7)
- [x] 2.2 Keep `created_at` from Classic `created`
- [x] 2.3 Keep `collection_id` and `reference_id` NOT NULL; exclude collection-less occurrences (D6), decided with the project owner

## 3. Schema (Phase 2)

- [x] 3.1 Replace the commented-out `occurrences` stub in `postgresql/02-core.sql` with the table, version triggers, and indexes
- [x] 3.2 Verify the DDL on a scratch database: chain insert, swing of `reidentifies_id` on a new version, nulls allowed
- [x] 3.3 Add `payloadSchemas/occurrence.schema.js` and `tests/fixtures/occurrence-example.json`
- [x] 3.4 Extend `payloadSchemas/tests/sources.test.js` with the occurrence source and its quirks
- [x] 3.5 Write `src/occurrences-migration/docs/occurrences.md`
- [x] 3.5a Inspect the 626 collection-less occurrences and generate `docs/occurrences-excluded.csv`
- [x] 3.6 `openspec validate create-occurrences-schema` passes

## Handed off (out of scope for this change)

Owned by another team member, in a follow-on change; the findings it needs are in design.md ("Handed off") and
the mapping doc.

- [ ] H.1 `src/occurrences-migration/migrate-occurrences.js`: stream, resolve, validate, batch-insert, two-pass or ordered chain linking, anomaly logging
- [ ] H.2 Runner step 11 with pre/postconditions and `src/README.txt`
- [ ] H.3 Register `occurrence` in `src/audit-payloads.js`
- [ ] H.4 Tests and a full-run timing (the current full run takes about 3 minutes; this table is ~12× specimens)
- [ ] H.5 Exclude the rows in `docs/occurrences-excluded.csv` by predicate and assert the count; a human decides the 6 `collection-lost` rows
- [ ] H.6 Decide the ditto-mark expansion (design: Open Questions)
