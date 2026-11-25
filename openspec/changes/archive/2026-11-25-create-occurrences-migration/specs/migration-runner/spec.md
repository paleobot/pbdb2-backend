## MODIFIED Requirements

### Requirement: The migration run order is frozen in the runner
`src/run-migrations.js` SHALL execute the migration scripts in exactly this order, and this order SHALL be
the authoritative statement of the sequence:

| # | Step name | Entry point |
|---|---|---|
| 1 | `persons` | `src/persons-migration/migrate-persons.js` |
| 2 | `pbot-persons` | `src/pbot-persons-migration/migrate-pbot-persons.js` |
| 3 | `refs` | `src/refs-migration/migrate-refs.js` |
| 4 | `pbot-refs` | `src/pbot-refs-migration/migrate-pbot-refs.js` |
| 5 | `pbot-schemas` | `src/pbot-schemas-migration/migrate-pbot-schemas.js` |
| 6 | `authorities` | `src/authorities-migration/migrate-authorities.js` |
| 7 | `authority-opinions` | `src/authority-opinions-migration/migrate-authority-opinions.js` |
| 8 | `opinions` | `src/opinions-migration/migrate-opinions.js` |
| 9 | `collections` | `src/collections-migration/migrate-collections.js` |
| 10 | `specimens` | `src/specimens-migration/migrate-specimens.js` |
| 11 | `taxa` | `src/rebuild-taxa.js` |
| 12 | `occurrences` | `src/occurrences-migration/migrate-occurrences.js` |

Every entry point in this table sits under `src/`. The table is the runner's own `STEPS` array restated,
so it is verifiable by reading `src/run-migrations.js` rather than by trusting this specification.

Rows 1–10 and 12 are migrations. Row 11 is not: `taxa` reads no legacy system, and its script calls
`rebuild_taxa_full()` (`db/03-taxa.sql`) to derive `taxa_linnaean`, `taxa_clades`, `taxa_attachments` and
`taxa` from the opinion tables earlier steps loaded. It is a step so that a full run leaves the taxa tables
populated, and so that it is held to the same ordering, precondition, postcondition and logging rules as
every other step.

The order SHALL satisfy these dependency edges, each of which exists because the later step reads from
PostgreSQL what the earlier step wrote:

```
persons ──┬─▶ pbot-persons ──┐
          │                  ├─▶ pbot-refs ──▶ pbot-schemas
          └─▶ refs ──────────┤
                             ├─▶ authorities ──▶ authority-opinions ──▶ opinions ──▶ taxa
                             ├─────────────────────────────────────────────▶ (refs)
                             ├─▶ collections ───────────────┐
                             ├──────────────────────────────┼─▶ specimens
                             ├─▶ (name_opinions) ───────────┤
                             └──────────────────────────────┴─▶ occurrences
```

- `pbot-persons` matches and updates the rows `persons` created.
- `refs` requires `persons` for its `authorizer_person_id` / `enterer_person_id` foreign keys.
- `pbot-refs` resolves its enterer through `persons.person->'legacyIDs'->>'pbotID'` and deduplicates
  against `refs`.
- `pbot-schemas` resolves its enterer through `persons.person->'legacyIDs'->>'pbotID'` and its primary
  reference through `refs.reference->'legacyIDs'->>'pbotID'`.
- `authorities` reads `refs` filtered on `reference->'legacyIDs'->>'oldpbdbID' IS NOT NULL`.
- `authority-opinions` reads `authorities`.
- `opinions` builds its name permid map from `name_opinions` and its reference map from `refs`.
- `collections` reads `refs` filtered on `reference->'legacyIDs'->>'oldpbdbID' IS NOT NULL`.
- `specimens` reads `refs` and `collections` through `legacyIDs.oldpbdbID`, and `name_opinions` through
  `oldpbdb_taxon_no`. It is the only step that reads from three other steps' output at once.
- `taxa` reads `name_opinions`, `assignment_opinions` and `validity_opinions`, which `authority-opinions`
  and `opinions` wrote. Nothing reads from it.
- `occurrences` reads `persons`, `refs` and `collections` through `legacyIDs.oldpbdbID`, and `name_opinions`
  through `oldpbdb_taxon_no`, the same inputs as `specimens`. It does not read `specimens` or the taxa tables.

The order SHALL NOT be changed except by a change that records the new order in this specification.

Rows 10 and 11 are additions rather than relocations: each introduces a step that did not previously
exist, where the nine preceding rows reached their current form by moving scripts already in the
repository. `taxa` could run as early as position 9, since it depends only on `opinions`; it is appended
instead, so that rows 1–10 keep their positions and a `--from` selection keeps the meaning it had.
Row 12 is likewise appended: `occurrences` could run as early as position 10, but inserting it would
renumber `taxa`.

#### Scenario: Full pipeline runs in the specified order
- **WHEN** `src/run-migrations.js` is invoked with no step-selection flag
- **THEN** it runs all twelve steps in the order given in the table, and does not begin a step until the preceding step has completed successfully

#### Scenario: Every entry point resolves under src/
- **WHEN** the runner spawns any of the twelve steps
- **THEN** the path it spawns is under `src/`, because no migration entry point remains at the repository root

#### Scenario: A new migration is appended, not inserted
- **WHEN** `specimens` is added to the run order
- **THEN** it takes position 10 after `collections`, and the preceding nine rows are left byte-for-byte unchanged, because its dependency edges are all satisfied by steps that already run before it

#### Scenario: The taxa step is appended after specimens
- **WHEN** `taxa` is added to the run order
- **THEN** it takes position 11, and rows 1–10 are left unchanged, even though its only dependency is `opinions` at position 8

#### Scenario: A full run populates the taxa tables
- **WHEN** a full run completes against an empty database
- **THEN** `taxa_linnaean`, `taxa_clades`, `taxa_attachments` and `taxa` are all non-empty, because the `taxa` step has called `rebuild_taxa_full()` over the loaded opinion tables

#### Scenario: The occurrences step is appended after taxa
- **WHEN** `occurrences` is added to the run order
- **THEN** it takes position 12, and rows 1–11 are left unchanged, even though its dependencies are all satisfied by position 10

#### Scenario: A full run populates the occurrence tables
- **WHEN** a full run completes against an empty database
- **THEN** `identifications`, `occurrence_abundances` and `occurrences` are all non-empty

### Requirement: Per-step preconditions assert what earlier steps produced
Immediately before spawning each step, the runner SHALL assert that step's preconditions against the
target database, and SHALL abort without spawning that step if any fails. Because three target tables have
two writers each — `persons` (steps 1, 2), `refs` (steps 3, 4), and `name_opinions` (steps 7, 8) — a
precondition SHALL be a per-step predicate rather than a uniform "target table is empty" rule.

| Step | Preconditions |
|---|---|
| `persons` | `persons` is empty |
| `pbot-persons` | `persons` is non-empty; no `persons` row has `person->'legacyIDs'->>'pbotID'` |
| `refs` | `refs` is empty; `persons` is non-empty |
| `pbot-refs` | `refs` is non-empty; no `refs` row has `reference->'legacyIDs'->>'pbotID'`; at least one `persons` row has `person->'legacyIDs'->>'pbotID'` |
| `pbot-schemas` | `schemas`, `characters`, and `states` are empty; at least one `persons` row has `person->'legacyIDs'->>'pbotID'`; at least one `refs` row has `reference->'legacyIDs'->>'pbotID'` |
| `authorities` | `authorities` is empty; at least one `refs` row has `reference->'legacyIDs'->>'oldpbdbID'` |
| `authority-opinions` | `name_opinions` is empty; `authorities` is non-empty |
| `opinions` | `assignment_opinions` and `validity_opinions` are empty; `name_opinions` is non-empty; `refs` is non-empty |
| `collections` | `collections` and `additional_collection_refs` are empty; at least one `refs` row has `reference->'legacyIDs'->>'oldpbdbID'` |
| `specimens` | `specimens` is empty; `collections` is non-empty; `name_opinions` is non-empty; at least one `refs` row has `reference->'legacyIDs'->>'oldpbdbID'` |
| `taxa` | `taxa` is empty; `name_opinions`, `assignment_opinions` and `validity_opinions` are non-empty |
| `occurrences` | `identifications`, `occurrence_abundances` and `occurrences` are empty; `collections` is non-empty; `name_opinions` is non-empty; at least one `refs` row has `reference->'legacyIDs'->>'oldpbdbID'` |

`taxa` is the first writer of `taxa_linnaean`, `taxa_clades`, `taxa_attachments` and `taxa`, so preflight
also requires all four to be empty when it is selected. `rebuild_taxa_full()` is itself safe to re-run,
but the runner loads an empty database once, like every other step: refreshing the taxa tables after the
opinion tables change is a direct `rebuild_taxa_full()` call, not a runner invocation.

#### Scenario: Reversed persons order is refused
- **WHEN** `pbot-persons` is selected against an empty `persons` table
- **THEN** its precondition fails, because `persons.id = person_no` holds only when `migrate-persons.js` inserts explicit ids before `migrate-pbot-persons.js` draws from the identity sequence

#### Scenario: Second writer requires a non-empty table
- **WHEN** `opinions` is about to run
- **THEN** its precondition on `name_opinions` is that the table is *non-empty*, and its guard against a repeat run is that `assignment_opinions` and `validity_opinions` are empty

#### Scenario: Stale PBot prerequisites are caught before the step runs
- **WHEN** `pbot-schemas` is about to run and no `refs` row carries `reference->'legacyIDs'->>'pbotID'`
- **THEN** its precondition fails and the step is not spawned, rather than the step exiting 0 having silently skipped every schema whose primary reference could not be resolved

#### Scenario: Specimens requires all three of its input tables
- **WHEN** `specimens` is about to run against a database where `collections` is populated but `name_opinions` is empty
- **THEN** its precondition fails and the step is not spawned, rather than the step running and leaving `name_opinions_permid` null on every row it could otherwise have resolved

#### Scenario: Taxa requires the opinion ledgers
- **WHEN** `--only taxa` is passed against a database where `opinions` never ran
- **THEN** the precondition that `assignment_opinions` is non-empty fails and the step is not spawned, rather than `rebuild_taxa_full()` deriving empty taxa tables and the step reporting no rows written

#### Scenario: The runner does not refresh populated taxa tables
- **WHEN** `--only taxa` is passed against a database whose `taxa` table already has rows
- **THEN** preflight fails on `taxa` not being empty and nothing is spawned, and the operator refreshes the tables by calling `rebuild_taxa_full()` directly

#### Scenario: Occurrences requires collections and name opinions
- **WHEN** `--only occurrences` is passed against a database where `name_opinions` is empty
- **THEN** its precondition fails and the step is not spawned, rather than loading every identification with a NULL `taxon_permid`

### Requirement: Per-step postconditions verify the step produced rows
Exit code 0 SHALL NOT by itself be treated as step success. After each step exits, the runner SHALL verify
that the exit code is 0 **and** that the row count of every table that step writes increased relative to
the count captured immediately before the step was spawned. The runner SHALL record each table's before
count, after count, and delta.

Tables written per step: `persons` → `persons`; `pbot-persons` → `persons`; `refs` → `refs`; `pbot-refs` →
`refs`; `pbot-schemas` → `schemas`, `characters`, `states`, `additional_schema_refs`; `authorities` →
`authorities`; `authority-opinions` → `name_opinions`; `opinions` → `assignment_opinions`,
`name_opinions`, `validity_opinions`; `collections` → `collections`, `additional_collection_refs`;
`specimens` → `specimens`; `taxa` → `taxa_linnaean`, `taxa_clades`, `taxa_attachments`, `taxa`;
`occurrences` → `identifications`, `occurrence_abundances`, `occurrences`.

`rebuild_taxa_full()` also rewrites `cycle_cuts`, but `cycle_cuts` is not among the tables `taxa` writes
for this purpose: it is a snapshot of the current cycle cuts and may legitimately be empty, so "the count
increased" is not a valid check on it.

The runner SHALL NOT compare deltas against hard-coded expected row counts, so that the assertion does not
drift as the source data changes.

#### Scenario: Clean exit that wrote nothing is a failure
- **WHEN** a step exits 0 but the row count of a table it writes is unchanged
- **THEN** the runner reports the step as failed and halts

#### Scenario: Counts are recorded, not asserted against constants
- **WHEN** `authorities` completes
- **THEN** the runner records the observed delta in the run log and asserts only that it is positive, rather than comparing it to a fixed expected total

#### Scenario: Specimens writes exactly one table
- **WHEN** `specimens` completes
- **THEN** the runner verifies that `specimens` gained rows, and asserts nothing about `collections`, `identifications`, `occurrences`, or any measurement table, because the step writes none of them

#### Scenario: Taxa must fill all four ledgers
- **WHEN** `taxa` exits 0 but `taxa_attachments` is still empty
- **THEN** the runner reports the step as failed and halts, and makes no assertion about `cycle_cuts`

#### Scenario: Occurrences must fill all three tables
- **WHEN** `occurrences` exits 0 but `occurrence_abundances` is still empty
- **THEN** the runner reports the step as failed and halts

### Requirement: The runner audits stored payloads after the last selected step
After the last selected step has passed its postconditions, the runner SHALL spawn `src/audit-payloads.js` as a child process, as it does for steps. The audit SHALL be scoped the same way postconditions are: the runner passes one `--entity` for each audit-registry entity whose table is written by a selected step (per the tables-written list in the postconditions requirement). Today `persons` → `person`, `refs` → `reference`, `authorities` → `authority`, `schemas` → `schema`, `characters` → `character`, `states` → `state`, `collections` → `collection`, `specimens` → `specimen`, `identifications` → `identification` and `occurrence_abundances` → `occurrence-abundance`; the `pbot-persons` and `pbot-refs` steps write the same tables as `persons` and `refs`. The tables `taxa` writes carry no payload and are not in the audit registry, so `taxa` adds no entity. `occurrences`, which the `occurrences` step also writes, is a derived cache with no payload of its own and is not in the registry either.

- When no selected step writes an audited table, the runner SHALL NOT spawn the audit, and it SHALL record in the run log that no audited tables were written.
- A non-zero audit exit SHALL be a run failure: the runner reports it and exits non-zero.
- The scope follows from the selection. The runner SHALL NOT provide a flag that skips or widens the audit.
- The audit SHALL NOT run when a step or check has already failed.

#### Scenario: Full run audits every audited entity
- **WHEN** `occurrences`, the last step, passes its postconditions in a full run
- **THEN** the runner spawns the audit with one `--entity` for each of `collection`, `specimen`, `person`, `reference`, `authority`, `schema`, `character`, `state`, `identification` and `occurrence-abundance`, and reports the run successful only if the audit exits 0

#### Scenario: Audit failure fails the run
- **WHEN** every step succeeds but the audit reports a violation
- **THEN** the runner exits non-zero and names the audit as the failed check

#### Scenario: Narrowed run audits only what it wrote
- **WHEN** the runner is invoked with `--only specimens`
- **THEN** the audit is spawned with `--entity specimen` only, and `collections` is not read

#### Scenario: Run that writes no audited table
- **WHEN** the runner is invoked with `--only authority-opinions`
- **THEN** the audit is not spawned, and the run log records that no audited tables were written

#### Scenario: The taxa step audits nothing
- **WHEN** the runner is invoked with `--only taxa`
- **THEN** the audit is not spawned, and the run log records that no audited tables were written

#### Scenario: No audit after a failure
- **WHEN** `collections` fails its postconditions
- **THEN** the runner halts without spawning the audit

#### Scenario: The refs steps audit reference
- **WHEN** the runner is invoked with `--only refs` or `--only pbot-refs`
- **THEN** the audit is spawned with `--entity reference` only

#### Scenario: The authorities step audits authority
- **WHEN** the runner is invoked with `--only authorities`
- **THEN** the audit is spawned with `--entity authority` only

#### Scenario: The pbot-schemas step audits schema, character and state
- **WHEN** the runner is invoked with `--only pbot-schemas`
- **THEN** the audit is spawned with `--entity schema`, `--entity character` and `--entity state`, and no other entity

#### Scenario: The occurrences step audits identification and occurrence-abundance
- **WHEN** the runner is invoked with `--only occurrences`
- **THEN** the audit is spawned with `--entity identification` and `--entity occurrence-abundance`, and no other entity
