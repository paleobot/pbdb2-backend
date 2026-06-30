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

### Requirement: Multi-entity read via `ids` list filter

The system SHALL accept an optional comma-separated `ids` query parameter on the
list endpoint of every uniform resource group (`references`, `authorities`,
`collections`, `specimens`), returning the matching current lineage heads. The multi-entity read SHALL be served by the existing list
endpoint and route — it SHALL NOT introduce a new path. When `ids` is present,
the system SHALL return only the requested resources; when `ids` is absent, the
list endpoint SHALL continue to return all current heads unchanged.

The response SHALL use the standard list envelope (`data` is an array) for every
multi-entity read, including a request for a single id. The singular
`data`-as-object shape SHALL remain reserved for the `GET /{permid}` path.

Requested ids SHALL be treated as a set: duplicates collapse and result order is
not guaranteed. `permid`s are opaque identifiers; the system SHALL NOT perform
per-id syntactic validation — an id that matches no current, non-removed head is
reported as missing rather than rejected.

#### Scenario: Multi-entity read returns the requested subset

- **WHEN** a client sends GET to a DB-backed resource list endpoint with
  `?ids=` naming several `permid`s that have current, non-removed heads
- **THEN** the system responds with HTTP 200
- **AND** `data` is an array containing exactly those resources

#### Scenario: Single id still returns a list

- **WHEN** a client sends GET to a resource list endpoint with `?ids=` naming a
  single `permid`
- **THEN** the system responds with HTTP 200
- **AND** `data` is an array containing the one resource

#### Scenario: Absent `ids` lists everything

- **WHEN** a client sends GET to a resource list endpoint with no `ids`
  parameter
- **THEN** the system returns all current lineage heads, as before

#### Scenario: Duplicate ids collapse

- **WHEN** a client sends `?ids=` naming the same `permid` more than once
- **THEN** that resource appears at most once in `data`

### Requirement: Multi-entity partial-success contract

A multi-entity read SHALL succeed with HTTP 200 and return the subset of
requested resources that exist, even when some requested ids have no current,
non-removed head. Missing ids SHALL NOT cause the request to fail.

The response `meta` SHALL report `requested` (the count of distinct requested
ids), `found`, `returned`, and `missing`. The `missing` field SHALL always be
present as an array of the requested ids that were not found, and SHALL be an
empty array when every requested id was found.

#### Scenario: Some requested ids are missing

- **WHEN** a client requests several ids where some have current heads and some
  do not
- **THEN** the system responds with HTTP 200
- **AND** `data` contains only the found resources
- **AND** `meta.missing` lists the requested ids that were not found

#### Scenario: All requested ids found

- **WHEN** a client requests ids that all have current heads
- **THEN** the system responds with HTTP 200
- **AND** `meta.missing` is an empty array

### Requirement: Empty `ids` parameter is rejected

The system SHALL distinguish an absent `ids` parameter from one that is present
but carries no value. An `ids` parameter that is present with an empty value (or
resolves to no ids after splitting) SHALL be rejected with HTTP 400. An absent
`ids` parameter SHALL NOT be rejected and SHALL list all current heads.

#### Scenario: Empty ids value is a 400

- **WHEN** a client sends a request with `?ids=` and no value
- **THEN** the system responds with HTTP 400 in the standard error shape

#### Scenario: Absent ids is not an error

- **WHEN** a client sends a request with no `ids` parameter at all
- **THEN** the system responds with HTTP 200 and lists all current heads

### Requirement: Multi-entity read batch cap

A single multi-entity read SHALL accept at most 100 distinct ids. A request
naming more than 100 ids SHALL be rejected with HTTP 400. A body-based batch
endpoint for larger sets is out of scope for this change.

#### Scenario: Over-cap request is rejected

- **WHEN** a client sends `?ids=` naming more than 100 ids
- **THEN** the system responds with HTTP 400 in the standard error shape

#### Scenario: At-cap request is accepted

- **WHEN** a client sends `?ids=` naming 100 or fewer ids
- **THEN** the system processes the multi-entity read normally

### Requirement: Multi-entity read stub fallback

A multi-entity read SHALL echo each requested id back as a stub record on any
stub-backed resource group — `specimens`, or any build with no database
configured. The response SHALL use the same list envelope and partial-success
`meta` shape as the DB-backed path, with `meta.missing` empty (every echoed id
is "found").

#### Scenario: Stub resource echoes requested ids

- **WHEN** a client sends GET to a stub-backed resource list endpoint with
  `?ids=` naming several ids
- **THEN** the system responds with HTTP 200
- **AND** `data` is an array of stub records, one per requested id
- **AND** `meta.missing` is an empty array

### Requirement: Per-entity field filters

The system SHALL support per-entity field filters on the list endpoint, declared
per resource and matching a query-parameter value against a field within that
resource's JSONB payload. The `references` group SHALL support a
`publication_type` filter matching the payload's `publicationType` field. Field
filters SHALL compose with the multi-entity `ids` read and with one another,
narrowing the same set of current, non-removed heads (logical AND).

A field-filter value that matches no current head SHALL yield an empty result
with HTTP 200 — field filters are pure filters and SHALL NOT produce the
`meta.missing` accounting reserved for the `ids` set semantics. A field-filter
parameter that is present with an empty value SHALL be rejected with HTTP 400.

When a field filter is combined with the `ids` read, the request SHALL be
treated as a filtered query: the `ids` partial-success accounting
(`meta.requested` / `meta.missing`) SHALL be suppressed. That accounting answers
"which requested ids have no current head?", which is only well-defined when the
id set is the sole constraint — a field filter introduces a second reason an id
can be absent from the result (filtered out rather than non-existent), so the
signal is withheld rather than overloaded.

#### Scenario: References filtered by publication type

- **WHEN** a client sends GET to the `references` list endpoint with
  `?publication_type=` naming a value
- **THEN** the system responds with HTTP 200
- **AND** `data` contains only the current heads whose `publicationType` equals
  that value

#### Scenario: Field filter composes with ids

- **WHEN** a client sends GET to `references` with both `?ids=` and
  `?publication_type=`
- **THEN** `data` contains only the requested ids that also match the
  publication type
- **AND** the `ids` partial-success accounting (`meta.requested` /
  `meta.missing`) is suppressed

#### Scenario: Field filter with no match

- **WHEN** a client sends `?publication_type=` with a value no current head has
- **THEN** the system responds with HTTP 200 and an empty `data` array
- **AND** no `meta.missing` accounting is produced

#### Scenario: Empty field-filter value is a 400

- **WHEN** a client sends `?publication_type=` with no value
- **THEN** the system responds with HTTP 400 in the standard error shape

### Requirement: Provisional lenient query-param handling

The system SHALL currently handle unrecognized input leniently: an unrecognized
query parameter SHALL be ignored, and a field-filter value outside any known set
SHALL yield an empty result rather than an error (filter values are treated as
opaque strings, with no enum validation). This leniency is provisional: once the
`pbdb2-dev` JSON Schemas are integrated, unrecognized parameters and
out-of-enum filter values MAY instead be rejected with HTTP 400, with the schema
as the source of the valid field set and value enums.

#### Scenario: Unknown query parameter is ignored

- **WHEN** a client sends a query parameter the resource does not recognize
- **THEN** the system does not reject the request for that parameter
- **AND** the unrecognized parameter does not filter the result

#### Scenario: Opaque filter value is not validated against an enum

- **WHEN** a client sends a field-filter value that is well-formed but matches no
  stored value
- **THEN** the system responds with HTTP 200 and an empty `data` array, not an
  enum-validation error
