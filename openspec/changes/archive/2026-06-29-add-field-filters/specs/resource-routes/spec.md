## ADDED Requirements

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
