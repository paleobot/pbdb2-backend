## ADDED Requirements

### Requirement: `payloadSchemas/` depends on nothing outside itself
Every JavaScript file under `payloadSchemas/`, including its tests, SHALL import and read only:
- files under `payloadSchemas/`;
- npm packages (bare specifiers such as `ajv/dist/2019.js`, `pg`, `dotenv/config`);
- Node built-ins (`node:` specifiers).

A relative import specifier (static `import … from`, side-effect `import '…'`, or dynamic `import('…')`) and a
file read through `new URL('…', import.meta.url)` SHALL resolve to a path inside `payloadSchemas/`. In
particular, nothing under `payloadSchemas/` SHALL import from `src/`, `migration_exploration/`, `play/` or the
repository-root `pg-*.js` modules.

The rule is one-way. Code outside `payloadSchemas/` MAY import from it, including its test fixtures:
`src/collections-migration/tests/test-collections-transforms.js` reading
`payloadSchemas/tests/fixtures/legacy-enums.json` is allowed.

Comments are not imports. A comment that cites a migration script as the origin of a stored shape (for
example, "the jsonb keys are the ones `src/authorities-migration` writes") does not violate the rule.

#### Scenario: A test imports the migrations' pool
- **WHEN** a file under `payloadSchemas/tests/` contains `import { pg } from '../../src/lib/pg-pool.js'`
- **THEN** the boundary guard test fails, naming that file and the specifier

#### Scenario: A fixture read that escapes the directory
- **WHEN** a file under `payloadSchemas/` reads `new URL('../../src/opinions-migration/inputs/x.csv', import.meta.url)`
- **THEN** the boundary guard test fails, naming that file and the path

#### Scenario: Package and built-in imports pass
- **WHEN** `payloadSchemas/lib/ajv.js` imports `ajv/dist/2019.js` and a test imports `node:test`
- **THEN** the guard test passes those specifiers

#### Scenario: Migrations importing payloadSchemas is allowed
- **WHEN** `src/audit-payloads.js` imports `../payloadSchemas/collection.schema.js`
- **THEN** no rule is broken, and the guard test does not inspect files outside `payloadSchemas/`

#### Scenario: A comment naming a migration path
- **WHEN** a `*.schema.js` header comment mentions `src/authorities-migration`
- **THEN** the guard test passes, because it inspects import specifiers and `import.meta.url` reads, not comment text

### Requirement: A guard test enforces the boundary in `npm test`
A guard test SHALL live in `payloadSchemas/tests/`, matched by the existing `npm test` glob
`payloadSchemas/tests/*.test.js`. It SHALL scan every `.js` file under `payloadSchemas/` and fail when any relative import specifier or
`new URL(…, import.meta.url)` read resolves outside `payloadSchemas/`. The failure message SHALL list each
offending file and specifier. The guard SHALL need no database connection.

#### Scenario: Clean tree
- **WHEN** `npm test` runs after this change
- **THEN** the guard test passes

#### Scenario: New violation caught
- **WHEN** a contributor adds a `payloadSchemas/lib/` module that imports `../../src/lib/uuidv7.js`
- **THEN** `npm test` fails at the guard test, naming that module and specifier

#### Scenario: Runs without a database
- **WHEN** no `PG_*` variable is set
- **THEN** the guard test still runs and reports its result

### Requirement: Database-backed tests get their connection from a tests-local helper
Tests under `payloadSchemas/tests/` that need a PostgreSQL connection SHALL obtain it from a helper module in
`payloadSchemas/tests/`. The helper SHALL:
- read `PG_HOST`, `PG_PORT` (default `5432`), `PG_USER`, `PG_PASSWORD`, `PG_DATABASE` and optional
  `PG_CA_CERT` from the environment, loading `.env` the same way the migrations do, so that one `.env`
  serves both;
- create the pool lazily, on first request, never when the helper is imported;
- when any required variable is missing, throw an error that names the missing variables, at the point a test
  requests the connection, and SHALL NOT call `process.exit`;
- provide a way to close the pool that is safe to call when no pool was ever created.

Database-backed tests SHALL request the connection inside the test body. Then a missing configuration fails
those tests individually while the file's other tests run and report. Database-backed tests SHALL NOT be
skipped when the configuration is missing. A missing connection is a failure, because the seed-fidelity test
is the only check on the dictionary seeds in `create_new.sql`.

#### Scenario: Pure tests survive a missing configuration
- **WHEN** `enums.test.js` runs with no `PG_*` variables set
- **THEN** its pure tests pass, and its two database tests fail with an error naming `PG_HOST`, `PG_USER`,
  `PG_PASSWORD` and `PG_DATABASE`

#### Scenario: Seed-fidelity test fails, not skips
- **WHEN** `dictionary-seeds.test.js` runs with no `PG_*` variables set
- **THEN** each of its tests fails with the error naming the missing variables, and none is reported as skipped

#### Scenario: Configured database
- **WHEN** the `PG_*` variables in `.env` point at a database built from `create_new.sql`
- **THEN** `enums.test.js` and `dictionary-seeds.test.js` pass exactly as they did when they imported
  `src/lib/pg-pool.js`

#### Scenario: Closing an unused pool
- **WHEN** a test file's `after` hook closes the pool and no test requested a connection
- **THEN** the close succeeds without creating a pool or raising an error
