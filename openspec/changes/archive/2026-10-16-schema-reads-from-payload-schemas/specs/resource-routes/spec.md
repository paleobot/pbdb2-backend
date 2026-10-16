## MODIFIED Requirements

### Requirement: Schemas aggregate read representation

The `schemas` resource SHALL return its read representation as an aggregate that
composes the schema together with its nested characters and states, rather than
as a flat single-record payload. On read, the aggregate SHALL be assembled from
data persisted in PostgreSQL, following only current, non-removed versions at the
schema, character, and state levels. A read for a `permid` with no current,
non-removed schema head SHALL respond with HTTP 404. Write handling for the
nested characters and states remains out of scope.

The schema part of the aggregate SHALL be the same record the `schemas` list
returns for that schema, and every character and state in it SHALL carry the
fields its payload source declares, including a state's `quantitative`
(`data-access`, "Schema aggregate tree read").

#### Scenario: Reading a schema returns its tree

- **WHEN** a client requests a single schema by its `permid` that has a current,
  non-removed head
- **THEN** `data` contains the schema together with its nested characters and
  states, drawn from PostgreSQL

#### Scenario: Reading a missing schema

- **WHEN** a client requests a schema `permid` with no current, non-removed head
- **THEN** the system responds with HTTP 404 in the standard error shape

#### Scenario: A schema's states report quantitative

- **WHEN** a client reads a schema whose tree holds a state with
  `states.quantitative = true`
- **THEN** that state in `data` carries `quantitative: true`
