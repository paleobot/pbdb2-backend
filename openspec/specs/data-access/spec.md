# data-access

## Purpose

The PostgreSQL data-access layer for PBDB2: a connection plugin configured from
the environment, a generic version-aware head-read repository, the schema
aggregate tree read, and an integration test harness that exercises the layer
against a real PostgreSQL instance. This capability isolates persistence so that
route handlers read through a single swappable seam.

## Requirements

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

### Requirement: Generic head-read repository
The system SHALL provide a generic read repository parameterized by a table name
and its JSONB payload column. The repository SHALL expose a single-resource read
that returns the current head of a lineage — the row matching a given `permid`
where `succeeded_by_id IS NULL` and the row is not soft-removed
(`NOT COALESCE(removed, false)`) — and a list read returning the current heads of
all non-removed lineages for the table. Returned records SHALL expose the public
`permid` and the JSONB payload, and SHALL NEVER expose internal serial ids or
version-chain columns.

A resource whose descriptor names a payload `source` SHALL instead be returned as
`merge(source, { jsonb, columns }, ctx)`:
- the head query selects `permid`, the payload, and the columns
  `storageColumns(source)` names;
- `ctx` is one codec context per read, loaded by `loadCodecContext` for
  `collectCodecSources(source)`. It is restricted through `codecKeyColumns(source)`
  to the keys the read's rows hold, so a single read and a page of a list each
  cost one lookup query per codec source.

Such a resource SHALL NOT also declare descriptor `links`: its links come from the
source's `x-link` properties. The head filter, field filters, keyset pagination and
the `ids` read SHALL behave identically for both kinds of resource. Columns
selected for `merge` SHALL NOT appear in the record except through `merge`.

As of this requirement, `authorities` reads through its source. `references`,
`collections`, `specimens` and `schemas` read the JSONB payload as stored.

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

#### Scenario: A source-backed record is merged

- **WHEN** an authority head with `reference_id = 7` is read
- **THEN** the record is the merged payload, whose `reference` is `{ permid, title }` for ref 7
- **AND** neither `reference_id` nor any `refs.id` appears in it

#### Scenario: One lookup per page

- **WHEN** a page of 50 authorities citing 30 distinct references is read
- **THEN** one query reads the heads and one query reads exactly those 30 `refs` rows

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

### Requirement: Responses of a resource with a payload source validate against its `out` variant
For a resource read through its payload source, every GET response's `data`, after `href` hydration, SHALL
validate against `deriveVariant(<source>, 'out')` compiled with `createAjv()`. Each list item counts as a
`data`. A unit test SHALL check this for the single, list and multi-entity (`ids`) reads and for the stub
read. An integration test against the real DDL SHALL check it for the single and list reads. Both SHALL cover
a linked resource with a label, one without, and one that is soft-removed.

The `out` variant is the response contract a client may rely on (`api/docs/response-contracts.md`, §2).
A response field that `out` does not declare fails these tests.

#### Scenario: Authority single read honours its contract
- **WHEN** an authority citing a titled reference is read by `permid`
- **THEN** `data` validates against the authority `out` variant

#### Scenario: Authority list items honour the contract
- **WHEN** the authorities list is read, including one authority whose reference has no title and one whose reference is soft-removed
- **THEN** every item of `data` validates against the authority `out` variant

#### Scenario: Stub honours the contract
- **WHEN** authorities are read with no database configured
- **THEN** the stub `data` validates against the authority `out` variant
