## MODIFIED Requirements

### Requirement: Per-entity field filters

The system SHALL support per-entity field filters on the list endpoint, declared
per resource and matching a query-parameter value against a field within that
resource's JSONB payload. The `references` group SHALL support a
`publication_type` filter matching the payload's `publicationType` field. Field
filters SHALL compose with the multi-entity `ids` read and with one another,
narrowing the same set of current, non-removed heads (logical AND).

When the field a filter matches is a property of the resource's payload source
that declares an `enum`, the filter's legal values SHALL be exactly that enum, and
a value outside it SHALL be rejected with HTTP 400 in the standard error shape.
The error message SHALL name the parameter and list the legal values in enum
order. The comparison is exact, after trimming surrounding whitespace. The
`references` `publication_type` filter takes its legal values from the reference
source's `publicationType` enum. A filter whose field has no such enum accepts any
non-empty value.

A legal field-filter value that matches no current head SHALL yield an empty
result with HTTP 200 — field filters are pure filters and SHALL NOT produce the
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

- **WHEN** a client sends `?publication_type=` with a legal value no current head has
- **THEN** the system responds with HTTP 200 and an empty `data` array
- **AND** no `meta.missing` accounting is produced

#### Scenario: Empty field-filter value is a 400

- **WHEN** a client sends `?publication_type=` with no value
- **THEN** the system responds with HTTP 400 in the standard error shape

#### Scenario: Field-filter value outside the enum is a 400

- **WHEN** a client sends `?publication_type=book`, which is not one of the
  reference source's publication types
- **THEN** the system responds with HTTP 400 in the standard error shape
- **AND** the message names `publication_type` and lists the legal values,
  including `standalone book`

#### Scenario: Enum check applies to the ids read

- **WHEN** a client sends `?ids=` together with a `publication_type` value outside
  the enum
- **THEN** the system responds with HTTP 400, as it would on a plain list

#### Scenario: Legal values come from the source

- **WHEN** the `references` repository is built
- **THEN** its `publication_type` filter's legal values equal
  `referenceSource.properties.publicationType.enum`, in order

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

The same reasoning applies to field-filter *values*. A value outside the legal
values that the resource's payload source declares for that field SHALL be
rejected with HTTP 400 (see "Per-entity field filters"), because an empty result
for a value that cannot exist reads as "nothing matched". Where the source
declares no enum for the field, values remain opaque: a well-formed value that
matches no stored value SHALL yield an empty result rather than an error.

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

#### Scenario: A legal filter value matching nothing is not an error

- **WHEN** a client sends a declared field-filter value that is legal for its
  field but matches no stored value
- **THEN** the system responds with HTTP 200 and an empty `data` array, not an
  error
