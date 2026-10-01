## MODIFIED Requirements

### Requirement: Environment-based connection configuration
The system SHALL read database connection parameters from the environment, loading the `.env` at the
backend repository root (outside `migrations/`) with the `dotenv` package, as `repository-layout`
requires: by a path computed from the loading module's own location, never from the working directory,
with variables already set in the environment taking precedence. The `.env` file MUST NOT be committed to
version control. The backend root's `.env.example`, with placeholder values, SHALL list every variable in
this spec's schema and SHALL be committed as documentation.

#### Scenario: .env file present with valid values
- **WHEN** a migration script is executed and the root `.env` exists with all required variables populated
- **THEN** the script connects to both MariaDB and PostgreSQL using those values

#### Scenario: Started from any directory
- **WHEN** a migration script is started from `migrations/`, from its own directory, or from the backend
  repository root
- **THEN** it reads the same root `.env` in every case

#### Scenario: .env file missing or incomplete
- **WHEN** a migration script is executed and the `.env` file is missing or has empty required variables
- **THEN** the script exits with a clear error message indicating which variables are missing

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
certificate for the PostgreSQL SSL connection. A relative path SHALL be resolved against the backend
repository root, not the working directory; an absolute path SHALL be used as given. The AWS RDS bundle is
committed at the backend root, so `PG_CA_CERT=global-bundle.pem` selects it.

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

#### Scenario: PG_CA_CERT set to a relative path
- **WHEN** `PG_CA_CERT=global-bundle.pem` and a migration script is started from `migrations/`
- **THEN** the certificate is read from `global-bundle.pem` at the backend repository root

#### Scenario: PG_CA_CERT set to a nonexistent path
- **WHEN** `PG_CA_CERT` is set but the file does not exist at that path
- **THEN** the system SHALL fail immediately with an error indicating the file could not be read

#### Scenario: Exploration-only variables are absent
- **WHEN** `PG_CLASSIC_*`, `PG_PLAY_*`, and `PG_MIGRATED_*` are not set
- **THEN** every script under `src/` and `npm test` behave exactly as when they are set
