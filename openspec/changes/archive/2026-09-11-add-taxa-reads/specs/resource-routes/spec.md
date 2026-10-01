## ADDED Requirements

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

## MODIFIED Requirements

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
