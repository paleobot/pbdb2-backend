## MODIFIED Requirements

### Requirement: CRUD verb coverage

The system SHALL expose create, read (single and list), update, and delete on
each uniform resource group (`references`, `authorities`, `collections`,
`specimens`) across the corresponding HTTP verbs (POST, GET, PUT/PATCH, DELETE).

The read verbs (GET list and GET single) for `references`, `authorities`, and
`collections` SHALL return data persisted in PostgreSQL, read as the current head
of each lineage via the generic read repository. A single read for a `permid`
with no current, non-removed head SHALL respond with HTTP 404. The `specimens`
read SHALL remain stubbed until a backing table exists (none is present in the
backend schema). The write verbs (POST, PUT, PATCH, DELETE) on all uniform groups
MAY continue to return stubbed responses and SHALL NOT access a database in this
change.

#### Scenario: List read

- **WHEN** a client sends GET to a DB-backed resource collection endpoint
  (`references`, `authorities`, `collections`)
- **THEN** the system responds with HTTP 200
- **AND** `data` is an array of current lineage heads from PostgreSQL

#### Scenario: Single read found

- **WHEN** a client sends GET to a DB-backed resource path with a `permid` that
  has a current, non-removed head
- **THEN** the system responds with HTTP 200
- **AND** `data` is the requested resource object identified by its `permid`

#### Scenario: Single read not found

- **WHEN** a client sends GET to a DB-backed resource path with a `permid` that
  has no current, non-removed head
- **THEN** the system responds with HTTP 404 in the standard error shape

#### Scenario: Specimens read remains stubbed

- **WHEN** a client sends GET to the `specimens` list or a `specimens` `permid`
- **THEN** the system responds with HTTP 200 from stubbed data, with no database
  access

#### Scenario: Create

- **WHEN** an authorized client sends POST to a resource collection endpoint
- **THEN** the system responds with a success status
- **AND** the created resource is returned in the standard envelope

#### Scenario: Update

- **WHEN** an authorized client sends PUT or PATCH to a resource path
- **THEN** the system responds with a success status
- **AND** the updated resource is returned in the standard envelope

#### Scenario: Delete

- **WHEN** an authorized client sends DELETE to a resource path
- **THEN** the system responds with a success status

### Requirement: Schemas aggregate read representation

The `schemas` resource SHALL return its read representation as an aggregate that
composes the schema together with its nested characters and states, rather than
as a flat single-record payload. On read, the aggregate SHALL be assembled from
data persisted in PostgreSQL, following only current, non-removed versions at the
schema, character, and state levels. A read for a `permid` with no current,
non-removed schema head SHALL respond with HTTP 404. Write handling for the
nested characters and states remains out of scope for this change.

#### Scenario: Reading a schema returns its tree

- **WHEN** a client requests a single schema by its `permid` that has a current,
  non-removed head
- **THEN** `data` contains the schema together with its nested characters and
  states, drawn from PostgreSQL

#### Scenario: Reading a missing schema

- **WHEN** a client requests a schema `permid` with no current, non-removed head
- **THEN** the system responds with HTTP 404 in the standard error shape
