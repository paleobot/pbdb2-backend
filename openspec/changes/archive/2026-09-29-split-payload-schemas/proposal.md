## Why

The planned backend monorepo (`docs/monorepo-plan.md`) rests on one rule: the migrations are temporary, so
nothing lasting may depend on migration code. `payloadSchemas/` is lasting. The API will validate and build
payloads with it long after PBDB Classic and PBot are shut down. Today it breaks the rule in two places:
two of its tests import the migrations' database pool, and it holds the migrations' legacy-to-2.0 mapping
documents. Fixing that now, inside the current layout, makes the later monorepo move a pure relocation
and puts the rule under test before anything else starts depending on it.

## What Changes

- **The mapping documents move to the migrations they describe.** The five files in
  `payloadSchemas/mappings/` go to a `docs/` subdirectory of their migration's directory under `src/`, with
  their names unchanged. The references to them in `src/`, `docs/` and `migration_exploration/` are updated.
- **The payload-schema tests get their own database connection.** `payloadSchemas/tests/enums.test.js` and
  `dictionary-seeds.test.js` stop importing `src/lib/pg-pool.js` and use a tests-only helper in
  `payloadSchemas/tests/`. When the `PG_*` variables are missing, the helper fails each database test with a
  message naming them. It does not exit the process, so the pure tests in `enums.test.js` still run and
  report. Today the whole file dies. The database tests are not skipped: the seed-fidelity test is the only
  check on `create_new.sql`'s dictionary seeds, and a skip would pass silently.
- **The rule is written down and tested.** A new capability states that nothing under `payloadSchemas/`
  imports or reads a file outside it, apart from npm packages and Node built-ins. A guard test in
  `npm test` enforces it. The rule runs one way: migrations keep importing `payloadSchemas/`, including its
  `legacy-enums.json` fixture.
- **The monorepo docs are corrected.** `docs/api-design-backlog.md` and `docs/monorepo-plan.md` currently
  describe this split as bigger than it is, and list the seed-fidelity test as migration-only. It is not:
  it guards the DDL's seeds and stays.

Nothing in `payloadSchemas/lib/` or the nine `*.schema.js` files changes. They already import nothing from
migration code, and every database access takes its connection as a parameter.

## Capabilities

### New Capabilities

- `payload-schemas-boundary`: `payloadSchemas/` is self-contained. Its modules and tests import and read only
  files under `payloadSchemas/`, npm packages and Node built-ins. Its database-backed tests get their
  connection from a tests-local helper that fails clearly and does not exit. A guard test enforces both.

### Modified Capabilities

- `migration-script-layout`: a migration's mapping documents (legacy-to-2.0 field mappings, read by people
  and not by the script) live in a `docs/` subdirectory of its directory. Until now, no rule placed them, which
  is how they ended up in `payloadSchemas/`.

## Impact

**Source and target**: no data moves. No MariaDB or PBot table is read, no PostgreSQL table is written, and
`create_new.sql` is unchanged. No anomaly from `anomaly-report.md` applies. No migration script's behaviour
changes. The only edits to migration code are two header comments, and the verification confirms the diff
touches nothing but comments.

**Files**:
- moved: `payloadSchemas/mappings/{opinions.md, specimens.md, authorities-opinions.md, collections.txt,
  collections-pbot.txt}`;
- edited: `payloadSchemas/tests/enums.test.js`, `payloadSchemas/tests/dictionary-seeds.test.js`;
- added: a pg helper and a boundary guard test under `payloadSchemas/tests/`;
- reference updates: `src/opinions-migration/migrate-opinions.js`,
  `src/specimens-migration/migrate-specimens.js`, `docs/taxa-opinions-migration-mapping.md`,
  `migration_exploration/DESIGN.md`, `migration_exploration/opinions-pair-mapping.md`;
- docs: `docs/api-design-backlog.md`, `docs/monorepo-plan.md`.

**Collaborators**: the mapping documents are living documents that others edit (`opinions.md` has commits from
NoisyFlowers). Their new locations need to be announced. Nothing else changes for anyone working on the DDL or
the payload schemas.

**Dependencies**: none added. The helper uses `pg` and `dotenv`, which the repo already depends on.

**Out of scope**: a `package.json` of its own for `payloadSchemas/` (it arrives with the monorepo's workspaces);
rewording schema comments that cite migration scripts as the provenance of their data; loosening the
seed-fidelity requirement once dictionaries become editable (API work); moving `src/audit-payloads.js`.
