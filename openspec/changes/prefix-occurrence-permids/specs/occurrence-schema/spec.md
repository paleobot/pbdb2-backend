## MODIFIED Requirements

### Requirement: Occurrences are a versioned table that links to its taxon by permid
The `occurrences` table SHALL be defined in `db/02-core.sql` as a versioned entity table: a `bigint`
identity `id`, a `permid` with the `OCC` prefix that is `text COLLATE "C"`, checked, and a foreign key to the
`permids` registry like every other versioned table's (`prefixed-permids`), its generated `permid_no` and
`occurrences_one_head_per_number` constraint, `authorizer_person_id` and `enterer_person_id` referencing `persons`, an
`occurrence` jsonb payload, the `preceded_by_id` / `succeeded_by_id` / `removed` / `created_at` columns, and the
standard version triggers installed through `install_version_triggers`.

The taxon SHALL be carried as `taxon_permid`, holding the `TXN` permid of a root `name_opinions` row (the name as the
occurrence spells it). It SHALL be `text COLLATE "C"` with the `TXN` CHECK and a foreign key to `permids`, like
`specimens.name_opinions_permid`, and SHALL NOT be a foreign key to `taxa`. It SHALL be nullable.

#### Scenario: Versioning behaves like other entity tables
- **WHEN** a row is inserted with the permid of an existing head
- **THEN** the new row's `preceded_by_id` is set to that head and the head's `succeeded_by_id` is set to the new row

#### Scenario: The permid is an OCC permid
- **WHEN** an occurrence is inserted with a valid, registered `COL-…` permid, or with an unregistered `OCC-…` permid
- **THEN** PostgreSQL rejects the first with a check-constraint violation and the second with a foreign-key violation

#### Scenario: A taxon is not required
- **WHEN** an occurrence is inserted with `taxon_permid` NULL
- **THEN** the insert succeeds

#### Scenario: The taxon is a TXN permid
- **WHEN** an occurrence is inserted with a registered `TXN-…` permid as `taxon_permid`
- **THEN** the insert succeeds

#### Scenario: No swing FK to taxa
- **WHEN** the table's constraints are listed
- **THEN** none references `taxa`
