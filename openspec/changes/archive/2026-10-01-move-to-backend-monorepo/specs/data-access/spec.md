## MODIFIED Requirements

### Requirement: PostgreSQL connection plugin

The system SHALL establish a PostgreSQL connection as a Fastify plugin,
configured exclusively from environment variables: `PG_HOST`, `PG_PORT`
(defaulting to `5432`), `PG_USER`, `PG_PASSWORD`, `PG_DATABASE`, and an optional
`PG_CA_CERT` whose presence enables SSL. Those variables MAY come from the
backend repository root's `.env`, which the API SHALL load as
`repository-layout` requires: by a path computed from its own source location,
never from the working directory, with variables already set in the environment
taking precedence and a missing file not an error. A relative `PG_CA_CERT` SHALL
be resolved against the backend repository root; an absolute one SHALL be used
as given. The pool SHALL be bounded (max 5 connections) and SHALL be closed
cleanly on application shutdown. The connection SHALL be exposed to handlers
through a single Fastify decorator so that the data source is swappable without
touching route definitions.

#### Scenario: Connection configured from environment

- **WHEN** the application is built with the `PG_*` environment variables set
- **THEN** a bounded PostgreSQL pool is created from those variables
- **AND** the pool is reachable by handlers via the Fastify decorator

#### Scenario: Root `.env` found from the API's directory

- **WHEN** the API is started from `api/` and the `PG_*` variables are set only
  in the backend root's `.env`
- **THEN** the pool is created from those values

#### Scenario: SSL enabled by certificate presence

- **WHEN** `PG_CA_CERT` is set to a readable certificate path
- **THEN** the pool connects using SSL with that CA certificate
- **AND** when `PG_CA_CERT` is unset, the pool connects without SSL

#### Scenario: Relative certificate path

- **WHEN** `PG_CA_CERT=global-bundle.pem` and the API is started from `api/`
- **THEN** the certificate is read from `global-bundle.pem` at the backend
  repository root

#### Scenario: Pool closed on shutdown

- **WHEN** the Fastify instance is closed
- **THEN** the PostgreSQL pool is drained and closed

### Requirement: Integration test harness against real PostgreSQL

The system SHALL provide an integration test suite, runnable via a dedicated
`test:integration` script separate from the default test run, that provisions an
ephemeral database (named `pbdb2_test_<random>`) on the PostgreSQL instance
identified by the `PG_*` environment variables, loads the backend schema
(the `NN-*.sql` DDL files in `db/` at the backend repository root, in the same
repository, in sorted name order, including its lineage triggers), seeds
fixtures, exercises the read repository and schema tree against that database,
and drops the ephemeral database when the run completes. The harness SHALL
locate `db/` from its own file's location; `DDL_DIR` SHALL override it. The
default `npm test` run SHALL NOT require a database.

When the DDL directory holds no `NN-*.sql` files, the harness SHALL report the
suite as unavailable with the directory it looked in, so a wrong path is visible
rather than silent.

#### Scenario: Ephemeral database lifecycle

- **WHEN** the integration suite runs
- **THEN** it creates a uniquely named ephemeral database, loads the backend
  schema and fixtures into it, runs the read assertions, and drops the database
  afterward

#### Scenario: DDL from the same repository

- **WHEN** the integration suite runs with `DDL_DIR` unset
- **THEN** it loads `db/01-dictionaries.sql`, `db/02-core.sql` and
  `db/03-taxa.sql` from the backend repository, with no sibling checkout needed

#### Scenario: Default tests need no database

- **WHEN** `npm test` runs
- **THEN** the suite passes without any PostgreSQL connection
