# resource-routes

## Purpose

The six PBDB2 resource route groups — references, authorities, collections,
specimens, schemas, and taxa — exposed under the versioned base path and
addressed by `permid`. Four are uniform CRUD; `schemas` returns an aggregate tree
on read; `taxa` is read-only, answering 405 on every write verb because it is
derived output rather than hand-entered data.

This capability also governs what a request may carry: the multi-entity `ids`
read, per-entity field filters, the pagination parameters, and the rule that an
unrecognized query parameter is rejected rather than ignored.

## Requirements

### Requirement: Resource route groups

The system SHALL provide route groups for `references`, `authorities`,
`collections`, `specimens`, `schemas`, and `taxa` under the versioned API base
path. Each route group SHALL be addressable by `permid`.

Five groups expose full CRUD verb coverage; `taxa` is read-only. `schemas`
returns an aggregate tree on single read; `taxa` returns a representation
carrying its containing-taxa chain.

#### Scenario: Each resource group is mounted

- **WHEN** a client requests the list endpoint of any of the six resources
- **THEN** the system responds with HTTP 200 in the standard envelope

#### Scenario: Taxa is mounted as a read-only group

- **WHEN** a client requests the `taxa` list endpoint
- **THEN** the system responds with HTTP 200 in the standard envelope
- **AND** the group exposes no write verbs

#### Scenario: Each group is addressable by permid

- **WHEN** a client requests a resource path with a `permid`
- **THEN** the addressed resource is identified by that `permid`

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

### Requirement: Read-only resource groups

The system SHALL support read-only route groups as a first-class shape of the
shared route factory, not as hand-written exceptions. A read-only group exposes
the read verbs (GET list and GET single) and SHALL answer every write verb (POST,
PUT, PATCH, DELETE) with HTTP 405 and an `Allow` header naming the permitted
methods.

A read-only group SHALL NOT attach the authentication preHandler to its write
verbs: there is no write to authorize, and the method is refused regardless of
the caller's identity.

`taxa` is the first such group. Read-only status is a property of the resource,
declared where its routes are registered, so that a further derived-table
resource requires no new factory work.

#### Scenario: Read verbs are served

- **WHEN** a client sends GET to a read-only group's list or item path
- **THEN** the system responds with HTTP 200 in the standard envelope

#### Scenario: Write verbs are refused with 405

- **WHEN** a client sends POST, PUT, PATCH or DELETE to a read-only group's list
  or item path
- **THEN** the system responds with HTTP 405 in the standard error shape
- **AND** the response carries an `Allow` header naming the permitted methods

#### Scenario: A refused write verb is not an authentication failure

- **WHEN** an unauthenticated client sends a write verb to a read-only group
- **THEN** the system responds with HTTP 405, not an authentication error

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

### Requirement: List endpoints accept pagination parameters

Every list endpoint — on the uniform resource groups and on `schemas` — SHALL
accept the `limit` and `cursor` pagination parameters and return a bounded page
with pagination links, per the `list-pagination` capability. A list endpoint
SHALL NOT return an unbounded result set.

#### Scenario: Every list endpoint is bounded

- **WHEN** a client sends GET to any resource list endpoint with no parameters
- **THEN** the system responds with HTTP 200
- **AND** `data` contains at most the default page size

### Requirement: The `schemas` list uses the shared list-filter seam

The `schemas` list endpoint SHALL parse its query parameters through the same
shared list-filter seam as the uniform resource groups, rather than reading heads
directly. It SHALL thereby accept the multi-entity `ids` read and the pagination
parameters on the same terms as every other list endpoint. The `schemas` single
read SHALL remain the aggregate tree, which is not paginated.

#### Scenario: Schemas list accepts ids

- **WHEN** a client sends GET to the `schemas` list endpoint with `?ids=` naming
  several `permid`s
- **THEN** the system responds with HTTP 200
- **AND** `data` contains exactly the requested schema heads

#### Scenario: Schemas list is paginated

- **WHEN** a client sends GET to the `schemas` list endpoint with `?limit=`
- **THEN** `data` contains at most that many schema heads
- **AND** `links.next` is a URL when further schemas exist

#### Scenario: The schema tree is not paginated

- **WHEN** a client requests a single schema by `permid`
- **THEN** the aggregate tree is returned whole, with its nested characters and
  states unpaginated

### Requirement: Strict query-param handling

The system SHALL reject a request carrying an unrecognized query parameter with
HTTP 400, naming the unrecognized parameter or parameters. This SHALL apply to
single reads as well as list reads, so that parameter handling does not differ by
endpoint shape.

A parameter is recognized when it is one of the universal list parameters
(`ids`, `limit`, `cursor`), a field filter the resource declares, or an
expansion parameter the resource declares. A resource that declares no filters
and no expansions therefore recognizes only the universal list parameters on its
list endpoint, and none on its single read.

This replaces the previous provisional leniency, under which an unrecognized
parameter was ignored. The reason is that a silently ignored parameter yields a
response indistinguishable from a correct one — a misspelled filter returns an
unfiltered list that reads as "everything matched", and a misspelled expansion
returns an unexpanded record that reads as "there was nothing to expand".

Field-filter *values* remain opaque strings with no enum validation: a well-formed
value matching no stored value SHALL still yield an empty result rather than an
error. That leniency is unchanged and remains provisional pending integration of
the `pbdb2-dev` JSON Schemas, which would supply the value enums.

#### Scenario: Unknown query parameter is rejected

- **WHEN** a client sends a query parameter the resource does not recognize
- **THEN** the system responds with HTTP 400 in the standard error shape
- **AND** the error names the unrecognized parameter

#### Scenario: Unknown parameter is rejected on a single read

- **WHEN** a client sends an unrecognized query parameter to a single-resource
  read
- **THEN** the system responds with HTTP 400, as it would on a list read

#### Scenario: Declared parameters are accepted

- **WHEN** a client sends a field filter or expansion parameter the resource
  declares
- **THEN** the request is not rejected for that parameter

#### Scenario: Opaque filter value is still not validated against an enum

- **WHEN** a client sends a declared field-filter value that is well-formed but
  matches no stored value
- **THEN** the system responds with HTTP 200 and an empty `data` array, not an
  enum-validation error
