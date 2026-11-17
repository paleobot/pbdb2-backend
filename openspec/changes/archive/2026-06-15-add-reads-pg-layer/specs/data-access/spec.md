## ADDED Requirements

### Requirement: PostgreSQL connection plugin

The system SHALL establish a PostgreSQL connection as a Fastify plugin,
configured exclusively from environment variables: `PG_HOST`, `PG_PORT`
(defaulting to `5432`), `PG_USER`, `PG_PASSWORD`, `PG_DATABASE`, and an optional
`PG_CA_CERT` whose presence enables SSL. The pool SHALL be bounded (max 5
connections) and SHALL be closed cleanly on application shutdown. The connection
SHALL be exposed to handlers through a single Fastify decorator so that the data
source is swappable without touching route definitions.

#### Scenario: Connection configured from environment

- **WHEN** the application is built with the `PG_*` environment variables set
- **THEN** a bounded PostgreSQL pool is created from those variables
- **AND** the pool is reachable by handlers via the Fastify decorator

#### Scenario: SSL enabled by certificate presence

- **WHEN** `PG_CA_CERT` is set to a readable certificate path
- **THEN** the pool connects using SSL with that CA certificate
- **AND** when `PG_CA_CERT` is unset, the pool connects without SSL

#### Scenario: Pool closed on shutdown

- **WHEN** the Fastify instance is closed
- **THEN** the PostgreSQL pool is drained and closed

### Requirement: Generic head-read repository

The system SHALL provide a generic read repository parameterized by a table name
and its JSONB payload column. The repository SHALL expose a single-resource read
that returns the current head of a lineage — the row matching a given `permid`
where `succeeded_by_id IS NULL` and the row is not soft-removed
(`NOT COALESCE(removed, false)`) — and a list read returning the current heads of
all non-removed lineages for the table. Returned records SHALL expose the public
`permid` and the JSONB payload, and SHALL NEVER expose internal serial ids or
version-chain columns.

#### Scenario: Read current head by permid

- **WHEN** the repository is asked for a `permid` that has a non-removed head
- **THEN** it returns that head row's `permid` and JSONB payload

#### Scenario: Superseded and removed versions are excluded

- **WHEN** a lineage's head has `succeeded_by_id` set, or its head is
  soft-removed
- **THEN** a head read for that `permid` returns no record

#### Scenario: Missing permid yields no record

- **WHEN** the repository is asked for a `permid` with no matching lineage
- **THEN** it returns no record (the caller surfaces this as a 404)

#### Scenario: List returns only current heads

- **WHEN** the repository lists a table
- **THEN** it returns one record per non-removed lineage head
- **AND** superseded and removed rows are excluded

### Requirement: Schema aggregate tree read

The system SHALL read a `schemas` resource as an aggregate tree composing the
schema head with its nested characters and states, assembled in a single
recursive query that follows only current, non-removed versions
(`succeeded_by_id IS NULL AND NOT COALESCE(removed, false)`) at every level. The
assembled tree SHALL identify every node by its `permid`.

#### Scenario: Schema tree assembled from current versions

- **WHEN** a schema is read by its `permid`
- **THEN** the result contains the schema payload plus its nested characters and
  states drawn only from current, non-removed versions
- **AND** every node in the tree is identified by its `permid`

### Requirement: Integration test harness against real PostgreSQL

The system SHALL provide an integration test suite, runnable via a dedicated
`test:integration` script separate from the default test run, that provisions an
ephemeral database (named `pbdb2_test_<random>`) on the PostgreSQL instance
identified by the `PG_*` environment variables, loads the backend schema
(`create_new.sql`, including its lineage triggers), seeds fixtures, exercises the
read repository and schema tree against that database, and drops the ephemeral
database when the run completes. The default `npm test` run SHALL NOT require a
database.

#### Scenario: Ephemeral database lifecycle

- **WHEN** the integration suite runs
- **THEN** it creates a uniquely named ephemeral database, loads the backend
  schema and fixtures into it, runs the read assertions, and drops the database
  afterward

#### Scenario: Default tests need no database

- **WHEN** `npm test` runs
- **THEN** the suite passes without any PostgreSQL connection
