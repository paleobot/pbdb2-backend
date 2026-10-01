## ADDED Requirements

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
