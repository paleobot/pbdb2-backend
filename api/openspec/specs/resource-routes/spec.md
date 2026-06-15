# resource-routes

## Purpose

The five PBDB2 resource route groups — references, authorities, collections,
specimens, and schemas — exposing CRUD across HTTP verbs under the versioned
base path, addressed by `permid`. Four are uniform; `schemas` returns an
aggregate tree on read.

## Requirements

### Requirement: Resource route groups

The system SHALL provide route groups for `references`, `authorities`,
`collections`, `specimens`, and `schemas` under the versioned API base path.
Each route group SHALL be addressable by `permid`.

#### Scenario: Each resource group is mounted

- **WHEN** a client requests the list endpoint of any of the five resources
- **THEN** the request is handled by that resource's route group
- **AND** the response uses the standard `data`/`meta`/`links` envelope

#### Scenario: Single resource addressed by permid

- **WHEN** a client requests a single resource by its `permid`
- **THEN** the matching resource is returned in `data`
- **AND** its `permid` is present in `data`

### Requirement: CRUD verb coverage

The system SHALL expose create, read (single and list), update, and delete on
each uniform resource group (`references`, `authorities`, `collections`,
`specimens`) across the corresponding HTTP verbs (POST, GET, PUT/PATCH, DELETE).
For this change, handlers MAY return stubbed responses and SHALL NOT access a
database.

#### Scenario: List read

- **WHEN** a client sends GET to a resource collection endpoint
- **THEN** the system responds with HTTP 200
- **AND** `data` is an array

#### Scenario: Single read

- **WHEN** a client sends GET to a resource path with a `permid`
- **THEN** the system responds with HTTP 200
- **AND** `data` is the requested resource object

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
as a flat single-record payload. Write handling for the nested characters and
states is out of scope for this change.

#### Scenario: Reading a schema returns its tree

- **WHEN** a client requests a single schema by its `permid`
- **THEN** `data` contains the schema together with its nested characters and
  states
