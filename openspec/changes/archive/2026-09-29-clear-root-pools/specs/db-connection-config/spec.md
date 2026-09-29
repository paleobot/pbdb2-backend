## MODIFIED Requirements

### Requirement: Shared connection module
The system SHALL provide database connection pools as separate modules that can be imported
independently.

**`src/lib/` is the connection-module set.** Every migration script lives under `src/` and SHALL import its
pools from `src/lib/`:
- `src/lib/pg-pool.js` — exports a `pg.Pool` instance for the target PostgreSQL database and a `closePg()` function
- `src/lib/mariadb-pool.js` — exports a `mysql2/promise` connection pool for the source MariaDB database and a `closeMariadb()` function
- `src/lib/db.js` — re-exports `mariadb` from `src/lib/mariadb-pool.js`, `pg` from `src/lib/pg-pool.js`, and a `closeAll()` function that closes both pools

**The repository root holds no pool modules.** The parallel root-level set that existed while migration
scripts were being relocated under `src/` has been retired. Root `db.js`, `uuidv7.js`, and `mariadb-pool.js`
were deleted once the last migration script moved. Root `pg-pool.js` was kept while `play/server.js`, a demo
API, imported it, and was deleted together with `play/`. The specialty pools `pg-classic-pool.js`,
`pg-migrated-pool.js`, and `pg-play-pool.js` moved into `migration_exploration/testing/`, their only
consumers. That folder is superseded and outside these specs, so its pools are too.

A new connection module SHALL be added under `src/lib/`, not at the repository root. `src/lib/` also
imports payload schemas from `payloadSchemas/`, which are contracts rather than utilities and are
deliberately not copied; the rule here is about where pools live, not a prohibition on referencing
anything above `src/`.

**There is no dual-database entry point outside `src/lib/`.** A future script that needs `mariadb` and `pg`
together SHALL be placed under `src/` and import `src/lib/db.js`; root `db.js` SHALL NOT be restored. This is
a decision, not an omission.

Regardless of which module is used, a script that only needs PostgreSQL SHALL import from the `pg-pool.js`
module directly rather than from `db.js`, avoiding any dependency on MariaDB configuration.

#### Scenario: PG-only script imports pg-pool.js
- **WHEN** a script imports `{ pg, closePg }` from `src/lib/pg-pool.js` and only `PG_*` env vars are set
- **THEN** the PostgreSQL pool is available for queries without requiring MariaDB env vars

#### Scenario: Dual-database script imports db.js
- **WHEN** a script imports `{ mariadb, pg, closeAll }` from `src/lib/db.js`
- **THEN** both pools are available for queries and `closeAll()` cleanly shuts down both connections

#### Scenario: Missing PG env vars
- **WHEN** a script imports from `src/lib/pg-pool.js` and required `PG_*` variables are missing
- **THEN** the module exits with an error listing the missing variables

#### Scenario: Missing MariaDB env vars
- **WHEN** a script imports from `src/lib/mariadb-pool.js` and required `MARIADB_*` variables are missing
- **THEN** the module exits with an error listing the missing variables

#### Scenario: Migration script imports the src/lib/ module
- **WHEN** a migration script under `src/` needs a connection pool
- **THEN** it imports from `../lib/pg-pool.js`, `../lib/mariadb-pool.js`, or `../lib/db.js`, because no root-level pool module exists

#### Scenario: A new connection is needed
- **WHEN** a script under `src/` needs a connection to a database that `src/lib/` doesn't cover
- **THEN** a new pool module is added under `src/lib/`, not at the repository root and not imported from `migration_exploration/`

#### Scenario: The repository root is checked for pools
- **WHEN** the repository root is listed
- **THEN** it contains no `pg-*.js`, `mariadb-pool.js`, or `db.js` module

#### Scenario: A future dual-database script is placed under src/
- **WHEN** a new script needs both the MariaDB and PostgreSQL pools
- **THEN** it is written under `src/` and imports `src/lib/db.js`, rather than a root-level `db.js` being reintroduced

### Requirement: .env variable schema
The `.env` file SHALL support the following variables:

| Variable | Required | Default |
|----------|----------|---------|
| MARIADB_HOST | yes (if using real MariaDB) | — |
| MARIADB_PORT | no | 3306 |
| MARIADB_USER | yes (if using real MariaDB) | — |
| MARIADB_PASSWORD | yes (if using real MariaDB) | — |
| MARIADB_DATABASE | no | pbdb_archive |
| PG_HOST | yes | — |
| PG_PORT | no | 5432 |
| PG_USER | yes | — |
| PG_PASSWORD | yes | — |
| PG_DATABASE | yes | — |
| PG_CA_CERT | no | — |

When `PG_CA_CERT` is set, the system SHALL read the file at that path and use its contents as the CA
certificate for the PostgreSQL SSL connection.

Variables read only by the pools in `migration_exploration/testing/` (`PG_CLASSIC_*`, `PG_PLAY_*`,
`PG_MIGRATED_*`) are outside this schema. A `.env` that sets them keeps working for those scripts, and one
that omits them is unaffected.

#### Scenario: Default port values
- **WHEN** `MARIADB_PORT` or `PG_PORT` is not set in `.env`
- **THEN** the connection module uses 3306 and 5432 respectively

#### Scenario: Default MariaDB database name
- **WHEN** `MARIADB_DATABASE` is not set in `.env`
- **THEN** the connection module connects to `pbdb_archive`

#### Scenario: PG_CA_CERT not set
- **WHEN** `PG_CA_CERT` is not set in `.env`
- **THEN** the PostgreSQL connection pool is created without SSL configuration

#### Scenario: PG_CA_CERT set to a valid certificate path
- **WHEN** `PG_CA_CERT` is set to a path containing a valid CA certificate file
- **THEN** the PostgreSQL connection pool is created with `ssl.ca` set to the file contents, enabling
  encrypted and CA-verified connections

#### Scenario: PG_CA_CERT set to a nonexistent path
- **WHEN** `PG_CA_CERT` is set but the file does not exist at that path
- **THEN** the system SHALL fail immediately with an error indicating the file could not be read

#### Scenario: Exploration-only variables are absent
- **WHEN** `PG_CLASSIC_*`, `PG_PLAY_*`, and `PG_MIGRATED_*` are not set
- **THEN** every script under `src/` and `npm test` behave exactly as when they are set

## REMOVED Requirements

### Requirement: Postgres-ported Classic connection module
**Reason**: `pg-classic-pool.js` moves into `migration_exploration/testing/`, its only consumer. That folder
is superseded and not described by the specs, and nothing under `src/` uses a Postgres-ported copy of
Classic.
**Migration**: None needed for the migrations. Scripts in `migration_exploration/testing/` import
`./pg-classic-pool.js` instead of `../../pg-classic-pool.js`; its `PG_CLASSIC_*` variables and behavior
are unchanged. A future `src/` script that needs Postgres-ported Classic adds a pool under `src/lib/`.
