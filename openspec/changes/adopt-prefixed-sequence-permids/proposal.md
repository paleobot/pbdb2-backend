## Why

The advisory committee wants identifiers people can cite, say and type, and is likely to require
entity-prefixed sequence numbers, with migrated records keeping their Classic number. A UUIDv7
permid is none of those things. Swapping the permid now costs only a rebuild, because nothing is
public and nothing outside this database mints permids. Once permids are cited, it would be a
data conversion. The reasoning is in `docs/api-design-backlog.md` ("Human-facing identifiers",
option B and the 2026-10-22 leaning) and in `design.md`.

## What Changes

- **BREAKING** Every exposed permid becomes `<PREFIX>-<number>-<CC>` text (for example
  `COL-12345-70`) instead of a UUIDv7. `CC` is ISO 7064 MOD 97-10 over the whole ID. The `uuid`
  permid columns, their version-7 CHECKs, and the `uuid[]` parameters, uuid temp tables and
  `::uuid` casts in the taxa functions all go.
- New `permids` registry (`permid` PK, `created_at`). It is the FK target for every permid
  column, including `subject_permid`, `target_permid`, `containing_permid`, `concept_permid`,
  `specimens.name_opinions_permid` and `homonyms.permid`, which have no integrity check today. Each
  permid column also CHECKs its own prefix, the format and the check digits.
- New SQL functions own the format: `register_permids(prefix, bigint[])` for legacy numbers and
  `mint_permids(prefix, n)` for sequence numbers. Both insert registry rows and return the text.
  One sequence per prefix, all starting at 1,000,000.
- Each table with a permid gets a generated `permid_no bigint`. Versioned tables get a unique index
  on it over heads.
- Migrated records keep their Classic number: `reference_no`, `person_no`, `collection_no`,
  `specimen_no`, and `taxon_no` for authorities and for root name opinions (a merged authority
  takes the lowest absorbed `taxon_no`). Everything else (PBot rows, sentinels, concept,
  misspelling and lineage name opinions, assignment and validity opinions, schemas, characters,
  states) takes a sequence number.
- Sequences start at 1,000,000 in the DDL itself, so a database built from the DDL can mint at once.
  The runner needs no new step.
- `migrations/src/lib/uuidv7.js` and the `uuid` dependency go. Scripts get permids from the SQL
  functions in batches.
- **BREAKING** (API) Lists and keyset pagination order by `permid_no`: Classic order first, then
  creation order. Path and `ids` lookups take the new form. The integration fixtures mint through
  SQL.
- `classification_path` ltree labels hold permids as-is. The `-`↔`_` swap goes from the taxa DDL
  and `api/src/lib/classification-path.js`.
- `homonyms.homonym_group_id` stays an internal UUIDv7.

## Capabilities

### New Capabilities
- `prefixed-permids`: the permid format and check digits, the prefix set (including the reserved
  `TXL` and `TXC`), the registry and its FKs, the per-column CHECKs, the mint and register
  functions, sequences and the floor, `permid_no`, and the numbering source for each table.

### Modified Capabilities
- `permid-uuidv7`: every requirement is removed and superseded by `prefixed-permids`, and the
  capability retires.
- `refs-migration`, `person-migration`, `collection-migration`, `specimen-migration`,
  `authorities-migration`: permids come from the Classic number through `register_permids`, not
  from the UUIDv7 helper. For authorities, a merged authority takes the lowest `taxon_no`.
- `pbot-refs-migration`, `pbot-person-migration`, `pbot-schema-migration`: permids come from
  `mint_permids`. The rule against reusing `pbotID` stays.
- `name-opinions-migration`: root rows take the source `authorities` row's own `taxon_no` as their
  `NOP` number, still
  stored as both `permid` and `subject_permid`.
- `synonymy-opinions-migration`, `assignment-opinions-migration`: permids come from the
  sequence, not `uuidv7()`.
- `taxa-opinions`: the "permid columns enforce uuidv7" requirement becomes the prefix, format and
  FK checks. `classification_path` labels are permids without the `_` swap. `homonym_group_id`
  keeps its v7 CHECK.
- `list-pagination`, `api-foundation`, `taxa-reads`: "ordered by `permid`" becomes numeric order
  of the permid's number (`permid_no`).
- `repository-layout`, `payload-schemas-boundary`: scenarios that use
  `migrations/src/lib/uuidv7.js` as their example import name a module that will no longer exist.
- `payload-audit`: the `(bigint, uuid)` lookup wording becomes `(bigint, text)`.

## Impact

- **Source to target.** MariaDB `pbdb_2026_10_18` (`refs`, `person`, `collections`, `specimens`,
  `authorities`, `opinions`) and PBot (persons, references, schemas, characters, states) go into
  PostgreSQL `refs`, `persons`, `collections`, `specimens`, `authorities`, `name_opinions`,
  `assignment_opinions`, `validity_opinions`, `schemas`, `characters` and `states`, plus the
  derived `taxa*` tables and `cycle_cuts`. Type mapping: Classic `int unsigned` `*_no` →
  `bigint` number → `text` permid; `uuid` → `text` everywhere else. `intervals`, `timescales`,
  `taxon_annotations` and `homonyms` are empty. They change type now.
- **Code.** `db/02-core.sql`, `db/03-taxa.sql` (`derive_taxa`, `rebuild_taxa_full`), every
  migration script under `migrations/src`, `api/src` (repositories' ordering and cursor,
  `classification-path.js`), `api/test/integration` fixtures, `docs/api-design-backlog.md` (the
  leaning becomes a decision).
- **Data integrity risks.**
  - A legacy number registered twice under one prefix, for example two authorities resolving to
    the same lowest `taxon_no`, must fail on the registry PK, not merge records. The registry makes
    this an error. Before, `place_in_lineage()` would have silently chained the second row onto the
    first.
  - Merged authorities: only the lowest `taxon_no` becomes the permid. The others must survive in
    `legacyIDs.oldpbdbIDs`, or citations of them are lost.
  - Every reference column that gains an FK may fail to load if the migration produces a permid
    that was never registered. Today those orphans pass silently. A failure here exposes
    pre-existing gaps, and the right response is to fix them, not drop the FK.
  - The rebuild must reproduce today's totals (runner assertions; 525,805 `taxa` rows), and two
    rebuilds must produce identical legacy-numbered permids.
- **Anomalies.** Classic `*_no` values are primary keys, so they're unique per table. 0-as-NULL
  values are already NULLs before any number is registered. The 1,117 duplicate-title reference
  groups (anomaly report §3) are separate records with separate `reference_no`s and keep them. No
  other listed anomaly touches permids.
- **Environments.** Rebuild localhost `pbdb`, then Aurora `pbdb2_migration_test`. Main and ddm-dev
  are untouched until the change merges from `permid-exp`.
