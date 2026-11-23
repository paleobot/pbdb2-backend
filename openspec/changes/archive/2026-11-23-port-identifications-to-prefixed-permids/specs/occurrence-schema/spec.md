## MODIFIED Requirements

### Requirement: Occurrences are a derived, unversioned cache
The `occurrences` table SHALL be defined as a plain, unversioned table with a `bigint` identity `id`, an `OCC` `permid` that is
`text COLLATE "C"`, checked, a foreign key to the `permids` registry, and UNIQUE, and that equals its root identification's permid, a
generated `permid_no` that is UNIQUE (`prefixed-permids`), `collection_id`, `reference_id`, `taxon_permid` (the winner's `TXN` permid,
with the same CHECK and registry foreign key as on `identifications`), an `identification` jsonb column holding the winning
identification's name block, a `plant_organs` column, `winning_identification_id`, `removed` and `created_at`. It SHALL NOT have the
`preceded_by_id` / `succeeded_by_id` version columns and SHALL NOT be written to by the application: its contents are derived from
`identifications` (see the `occurrence-derivation` capability).

#### Scenario: The cache is not versioned
- **WHEN** the `occurrences` columns are listed
- **THEN** neither `preceded_by_id` nor `succeeded_by_id` is among them

#### Scenario: One row per permid
- **WHEN** two rows are inserted with the same `permid`
- **THEN** the second insert fails with a unique violation

#### Scenario: The permid is an OCC permid
- **WHEN** an occurrence is inserted with a valid, registered `COL-…` permid
- **THEN** PostgreSQL rejects it with a check-constraint violation

#### Scenario: The winning identification is recorded
- **WHEN** the table's columns are listed
- **THEN** `winning_identification_id` references `identifications`
