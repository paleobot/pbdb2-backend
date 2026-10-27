## MODIFIED Requirements

### Requirement: A guard test enforces the boundary in `npm test`
A guard test SHALL live in `payloadSchemas/tests/`, run by the root `npm test`. It SHALL scan every `.js`
file under `payloadSchemas/` and fail when any relative import specifier or `new URL(…, import.meta.url)`
read resolves outside `payloadSchemas/`, except the tests-local database helper's read of the root `.env`.
The failure message SHALL list each offending file and specifier. The guard SHALL need no database
connection.

#### Scenario: Clean tree
- **WHEN** the root `npm test` runs
- **THEN** the guard test passes

#### Scenario: New violation caught
- **WHEN** a contributor adds a `payloadSchemas/lib/` module that imports `../../migrations/src/lib/pg-pool.js`
- **THEN** the root `npm test` fails at the guard test, naming that module and specifier

#### Scenario: Runs without a database
- **WHEN** no `PG_*` variable is set
- **THEN** the guard test still runs and reports its result
