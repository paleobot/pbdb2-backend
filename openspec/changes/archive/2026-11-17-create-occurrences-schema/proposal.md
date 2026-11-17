## Why

Classic `occurrences` (1,984,733 rows) and `reidentifications` (35,098 rows) are the largest unmigrated
core entity. The target `occurrences` table is commented out in `db/02-core.sql` because the old
placeholder predates the taxa/opinions identity inversion: it has a swing FK to the now-versioned `taxa`,
`text` permids, `integer` keys, and no payload column. The migration cannot be written until the target
shape exists, and the specimens migration already deferred its occurrence-derived taxon to this work.

This change delivers the target shape and the profiling that justifies it. The migration script itself is
a separate change, to be picked up by another team member.

## What Changes

- Replace the commented-out `occurrences` stub in `db/02-core.sql` with a real versioned table:
  uuidv7 `permid`, `bigint` keys, an `occurrence` jsonb payload, `taxon_permid` (a name permid, not a swing
  FK to `taxa`), `collection_id`, `reference_id`, person columns, `oldpbdb_occurrence_no` /
  `oldpbdb_reid_no` join keys, and `reidentifies_id`, a self-referencing pointer to the prior
  identification of the same specimen occurrence.
- Eliminate Classic's separate `reidentifications` table: each reidentification becomes its own
  `occurrences` row linked back to the identification it supersedes. No row is chosen as "current" at
  migration time; the chain head is derived at read time.
- Add `payloadSchemas/occurrence.schema.js`, the annotated source for the occurrence payload, with a
  fixture and a case in the sources test.
- Add a mapping document `migrations/src/occurrences-migration/docs/occurrences.md` recording the Classic → 2.0
  mapping and the Phase 0 findings the migration author needs.
- Keep `collection_id` and `reference_id` NOT NULL: an occurrence has no meaning outside its collection.
  The 626 Classic occurrences with no resolvable collection are not migrated; they are listed, by category, in
  `docs/occurrences-excluded.csv` (see design D6).

## Capabilities

### New Capabilities
- `occurrence-schema`: the target table shape for occurrences and reidentifications, and the payload
  schema stored in its jsonb column.

### Modified Capabilities

(none)

## Impact

- `db/02-core.sql`: new table and indexes (the DDL-layout guard still applies; nothing references a
  later file).
- `payloadSchemas/`: new `occurrence.schema.js`, new fixture, extended `tests/sources.test.js`.
- `migrations/src/occurrences-migration/docs/`: new mapping document. `docs/occurrences-excluded.csv`: the 641 source rows
  (626 occurrences, 15 reidentifications) the migration will not load, with a category each.
- No migration script, runner step, or audit registration is added here; those are the follow-on change.
