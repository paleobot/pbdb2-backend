## MODIFIED Requirements

### Requirement: Multi-entity partial-success contract

A multi-entity read SHALL succeed with HTTP 200 and return the subset of
requested resources that exist, even when some requested ids have no current,
non-removed head. Missing ids SHALL NOT cause the request to fail.

The response `meta` SHALL report `requested` (the count of distinct requested
ids), `returned`, and `missing`. The `missing` field SHALL always be present as
an array of the requested ids that were not found, and SHALL be an empty array
when every requested id was found. `meta` SHALL NOT report `found`, which would
always equal `returned` (`list-pagination`).

#### Scenario: Some requested ids are missing

- **WHEN** a client requests several ids where some have current heads and some
  do not
- **THEN** the system responds with HTTP 200
- **AND** `data` contains only the found resources
- **AND** `meta.missing` lists the requested ids that were not found
- **AND** `meta.returned` equals `meta.requested` minus the number of missing ids

#### Scenario: All requested ids found

- **WHEN** a client requests ids that all have current heads
- **THEN** the system responds with HTTP 200
- **AND** `meta.missing` is an empty array

### Requirement: Per-entity field filters

The system SHALL support per-entity field filters on the list endpoint, declared
per resource and matching a query-parameter value against a field within that
resource's JSONB payload. A field filter's query parameter SHALL be the name of
the payload field it matches, so that parameters, expansions and response fields
share one camelCase vocabulary. The `references` group SHALL support a
`publicationType` filter matching the payload's `publicationType` field. Field
filters SHALL compose with the multi-entity `ids` read and with one another,
narrowing the same set of current, non-removed heads (logical AND).

When the field a filter matches is a property of the resource's payload source
that declares an `enum`, the filter's legal values SHALL be exactly that enum, and
a value outside it SHALL be rejected with HTTP 400 in the standard error shape.
The error message SHALL name the parameter and list the legal values in enum
order. The comparison is exact, after trimming surrounding whitespace. The
`references` `publicationType` filter takes its legal values from the reference
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
  `?publicationType=` naming a value
- **THEN** the system responds with HTTP 200
- **AND** `data` contains only the current heads whose `publicationType` equals
  that value

#### Scenario: The former snake_case name is unrecognized

- **WHEN** a client sends GET to `references` with `?publication_type=` naming a
  legal value
- **THEN** the system responds with HTTP 400 in the standard error shape
- **AND** the message names `publication_type` as unrecognized and lists
  `publicationType` among the accepted parameters

#### Scenario: Field filter composes with ids

- **WHEN** a client sends GET to `references` with both `?ids=` and
  `?publicationType=`
- **THEN** `data` contains only the requested ids that also match the
  publication type
- **AND** the `ids` partial-success accounting (`meta.requested` /
  `meta.missing`) is suppressed

#### Scenario: Field filter with no match

- **WHEN** a client sends `?publicationType=` with a legal value no current head has
- **THEN** the system responds with HTTP 200 and an empty `data` array
- **AND** no `meta.missing` accounting is produced

#### Scenario: Empty field-filter value is a 400

- **WHEN** a client sends `?publicationType=` with no value
- **THEN** the system responds with HTTP 400 in the standard error shape

#### Scenario: Field-filter value outside the enum is a 400

- **WHEN** a client sends `?publicationType=book`, which is not one of the
  reference source's publication types
- **THEN** the system responds with HTTP 400 in the standard error shape
- **AND** the message names `publicationType` and lists the legal values,
  including `standalone book`

#### Scenario: Enum check applies to the ids read

- **WHEN** a client sends `?ids=` together with a `publicationType` value outside
  the enum
- **THEN** the system responds with HTTP 400, as it would on a plain list

#### Scenario: Legal values come from the source

- **WHEN** the `references` repository is built
- **THEN** its `publicationType` filter's legal values equal
  `referenceSource.properties.publicationType.enum`, in order
