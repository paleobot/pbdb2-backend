## MODIFIED Requirements

### Requirement: Resource route groups

The system SHALL provide route groups for `references`, `authorities`,
`collections`, `specimens`, `schemas`, `taxa` and `occurrences` under the
versioned API base path. Each route group SHALL be addressable by `permid`.

Five groups expose full CRUD verb coverage; `taxa` and `occurrences` are
read-only. `schemas` returns an aggregate tree on single read; `taxa` returns a
representation carrying its containing-taxa chain; `occurrences` embeds its
winning identification and serves every identification of an occurrence under
`/occurrences/{permid}/identifications` (`occurrence-reads`).

#### Scenario: Each resource group is mounted

- **WHEN** a client requests the list endpoint of any of the seven resources
- **THEN** the system responds with HTTP 200 in the standard envelope

#### Scenario: Taxa is mounted as a read-only group

- **WHEN** a client requests the `taxa` list endpoint
- **THEN** the system responds with HTTP 200 in the standard envelope
- **AND** the group exposes no write verbs

#### Scenario: Occurrences is mounted as a read-only group

- **WHEN** a client requests the `occurrences` list endpoint
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
(`ids`, `limit`, `cursor`), a field filter the resource declares, a link filter
the resource declares, or an expansion parameter the resource declares. A
resource that declares no filters and no expansions therefore recognizes only the
universal list parameters on its list endpoint, and none on its single read.

Each read route SHALL declare the parameters it recognizes as a querystring
schema, and the system SHALL validate requests against that schema, so that the
parameters the API description lists are the parameters the route enforces
(`api-description`). Before validation, every query value SHALL be trimmed of
surrounding whitespace, and a parameter declared as an integer SHALL be a bare
string of digits (so `1e3`, `0x10` and `1.0` are rejected, not converted). Each
parameter SHALL carry one value: a repeated parameter SHALL be rejected with HTTP
400. A validation failure SHALL be reported in the standard error shape with the
same message the parameter's rule gives on a hand-checked request, so declaring
the schema changes no response.

This replaces the previous provisional leniency, under which an unrecognized
parameter was ignored. The reason is that a silently ignored parameter yields a
response indistinguishable from a correct one — a misspelled filter returns an
unfiltered list that reads as "everything matched", and a misspelled expansion
returns an unexpanded record that reads as "there was nothing to expand".

The same reasoning applies to filter *values*. A value outside the legal values
that the resource's payload source declares for that field SHALL be rejected with
HTTP 400 (see "Per-entity field filters"), and so SHALL a link-filter value that is
not a permid of the filter's prefix (see "Per-entity link filters"), because an
empty result for a value that cannot exist reads as "nothing matched". Where the
source declares no enum for the field, values remain opaque: a well-formed value
that matches no stored value SHALL yield an empty result rather than an error.

#### Scenario: Unknown query parameter is rejected

- **WHEN** a client sends a query parameter the resource does not recognize
- **THEN** the system responds with HTTP 400 in the standard error shape
- **AND** the error names the unrecognized parameter

#### Scenario: Unknown parameter is rejected on a single read

- **WHEN** a client sends an unrecognized query parameter to a single-resource
  read
- **THEN** the system responds with HTTP 400, as it would on a list read

#### Scenario: Declared parameters are accepted

- **WHEN** a client sends a field filter, link filter or expansion parameter the
  resource declares
- **THEN** the request is not rejected for that parameter

#### Scenario: A legal filter value matching nothing is not an error

- **WHEN** a client sends a declared field-filter value that is legal for its
  field but matches no stored value
- **THEN** the system responds with HTTP 200 and an empty `data` array, not an
  error

#### Scenario: The declared schema is what is enforced

- **WHEN** the querystring schema a list route declares is compared with the
  parameters the route accepts
- **THEN** every declared parameter is accepted and any other is a 400 naming it

#### Scenario: Surrounding whitespace is trimmed

- **WHEN** a client sends `?publicationType=%20standalone%20book%20`
- **THEN** the filter matches `standalone book`, as without the spaces

#### Scenario: A non-decimal limit is rejected

- **WHEN** a client sends `?limit=1e3`, `?limit=0x10` or `?limit=1.0`
- **THEN** the system responds with HTTP 400 saying `limit` must be a positive integer

#### Scenario: A repeated parameter is rejected

- **WHEN** a client sends `?limit=5&limit=6`
- **THEN** the system responds with HTTP 400 in the standard error shape

## ADDED Requirements

### Requirement: Per-entity link filters

The system SHALL support link filters declared per resource on its list endpoint.
A link filter matches a
foreign key the resource's row carries (a column, not a payload field) against one
permid sent as the parameter's value. Its declaration SHALL name the permid prefix
its value must carry, and the parameter's querystring schema SHALL enforce that
prefix and the permid's form (`<PREFIX>-<digits>-<two digits>`). A value that fails
it SHALL be rejected with HTTP 400 in the standard error shape, naming the
parameter. The check digits SHALL NOT be verified: a well-formed permid that names
nothing SHALL yield an empty result with HTTP 200.

Link filters SHALL compose with field filters, with one another, with `ids` and with
pagination (logical AND), and SHALL appear in the API description with the other
parameters. A link-filter parameter present with an empty value SHALL be rejected
with HTTP 400. `occurrences` declares `collection`, `taxon` and `withinTaxon`
(`occurrence-reads`).

#### Scenario: A link filter is declared and described

- **WHEN** the description's `GET /api/v1/occurrences` operation is read
- **THEN** it lists `collection`, `taxon` and `withinTaxon` as query parameters

#### Scenario: Wrong prefix

- **WHEN** a client sends a link filter whose value carries another prefix
- **THEN** the system responds with HTTP 400 naming the parameter

#### Scenario: Not a permid

- **WHEN** a client sends `?collection=123`
- **THEN** the system responds with HTTP 400 naming `collection`

#### Scenario: Empty value

- **WHEN** a client sends `?taxon=`
- **THEN** the system responds with HTTP 400
