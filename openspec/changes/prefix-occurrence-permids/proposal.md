## Why

Andrew's `occurrences` table (create-occurrences-schema, merged from `main` in da11057) uses the
old uuidv7 permids: `permid uuid` with the version-7 CHECK, and `taxon_permid uuid`. Every other
table on this line uses prefixed text permids (`prefixed-permids`), so `taxon_permid` cannot even
hold the `TXN-…` permid it is meant to point to. This has to be fixed before an occurrences
migration is written against the table.

Giving occurrences their Classic number runs into the sequence floor. Classic `occurrence_no` goes
up to 2,078,017, but every permid sequence starts at 1,000,000, and `register_permids` refuses
legacy numbers of 1,000,000 or more. Raising one floor for every prefix keeps the rule simple: one
floor, above every Classic number that becomes a permid.

## What Changes

- New permid prefix `OCC` for `occurrences`, Classic's data-service occurrence prefix, upper-cased.
  It gets its own sequence.
- `occurrences.permid` becomes `text COLLATE "C"`, a foreign key to `permids`, with the `OCC` CHECK.
  The table gets `permid_no` and the `occurrences_one_head_per_number` constraint, like every other
  versioned table.
- `occurrences.taxon_permid` becomes `text COLLATE "C"`, a foreign key to `permids`, with the `TXN`
  CHECK, like `specimens.name_opinions_permid`. It is still not a foreign key to `taxa`. The column
  keeps its name.
- Numbering: a migrated occurrence takes its Classic `occurrence_no`. A reidentification, which is
  its own row with its own permid, and any new occurrence take a number from the `OCC` sequence.
  Classic `reid_no` overlaps `occurrence_no`, so it is not used as a number; it stays in
  `legacyIDs.oldpbdbReidID`.
- **BREAKING (permid values):** every sequence starts at 10,000,000 instead of 1,000,000, and
  `register_permids` accepts legacy numbers up to 9,999,999. On the next rebuild about 1.23 million
  sequence-numbered permids get new numbers (`AOP`, non-root `TXN`, `VOP`, `STA`, `CHR`, `SCH`, and
  PBot-only `REF` and `PRS`). Classic-numbered permids do not change. Nothing outside our own
  databases stores a permid yet, so nothing external breaks.
- The migration notes for occurrences (`migrations/src/occurrences-migration/docs/occurrences.md`)
  describe the new permid and `taxon_permid` values. No occurrences migration script is written here.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `prefixed-permids`: adds the `OCC` prefix, `occurrences.taxon_permid` as a `TXN` column, and the
  numbering source for occurrences; moves the sequence floor and the legacy-number limit to
  10,000,000.
- `occurrence-schema`: `permid` and `taxon_permid` become prefixed text permids instead of uuids.
- `assignment-opinions-migration`, `synonymy-opinions-migration`, `pbot-person-migration`,
  `pbot-refs-migration`, `pbot-schema-migration`: scenarios that state the minted number
  ("at least 1,000,000", `SCH-1000000-26`) follow the new floor.

## Impact

- `db/02-core.sql`: the `OCC` prefix and sequence, every sequence's start, `register_permids`, the
  occurrences table and its one-head constraint, comments.
- `api/test/integration/permids.test.js`: the floor values it asserts.
- `migrations/src/occurrences-migration/docs/occurrences.md`, `docs/api-design-backlog.md`.
- Databases: localhost and Aurora `pbdb2_migration_test` need a full rebuild, because the sequence
  numbers change. The occurrences table is empty in both.
- No API code changes: occurrences have no routes, and nothing in `api/src` or `migrations/src`
  depends on the floor's value.

**Data integrity.** No data is lost, but sequence-numbered permids are not stable across this
change: anything that recorded one (a test note, a bookmark, a scratch report) is out of date after
the rebuild. Classic-numbered permids, which are the ones that must be reproducible, are unchanged.
The occurrences migration (source: Classic `occurrences` and `reidentifications`; target:
`occurrences`) is a later change; this one only fixes the table and the numbering it will use.
