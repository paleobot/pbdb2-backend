## MODIFIED Requirements

### Requirement: Multi-entity partial-success contract

A multi-entity read SHALL succeed with HTTP 200 and return the subset of
requested resources that exist, even when some requested ids have no current,
non-removed head. Missing ids SHALL NOT cause the request to fail.

The JSON response `meta` SHALL report `requested` (the count of distinct requested
ids), `returned`, and `missing`. The `missing` field SHALL always be present as
an array of the requested ids that were not found, and SHALL be an empty array
when every requested id was found. `meta` SHALL NOT report `found`, which would
always equal `returned` (`list-pagination`). A multi-entity read returned as CSV
has no `meta` (`csv-output`): a client finds missing ids by comparing the `permid`
column with its request.

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

#### Scenario: Some requested ids are missing from a CSV read

- **WHEN** a client requests several ids as `text/csv` and some have no current head
- **THEN** the system responds with HTTP 200
- **AND** the body holds one record per found resource
