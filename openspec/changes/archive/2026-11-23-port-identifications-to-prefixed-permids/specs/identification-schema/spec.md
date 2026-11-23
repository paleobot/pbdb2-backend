## MODIFIED Requirements

### Requirement: Identifications are a versioned table that links to its taxon by permid
The `identifications` table SHALL be defined in `db/02-core.sql` as a versioned entity table: a `bigint` identity `id`, an `OCC`
`permid` that is `text COLLATE "C"`, checked, and a foreign key to the `permids` registry like every other versioned table's
(`prefixed-permids`), its generated `permid_no` and an `identifications_one_head_per_number` constraint, `authorizer_person_id` and
`enterer_person_id` referencing `persons`, an `identification` jsonb payload, `reference_id` referencing `refs` and NOT NULL, the
`preceded_by_id` / `succeeded_by_id` / `removed` / `created_at` columns, and the standard version triggers installed through
`install_version_triggers`.

The taxon SHALL be carried as `taxon_permid`, holding the `TXN` permid of a root `name_opinions` row (the name as the identifier spells
it). It SHALL be `text COLLATE "C"` with the `TXN` CHECK and a foreign key to `permids`, like `specimens.name_opinions_permid`, and SHALL
NOT be a foreign key to `taxa`. It SHALL be nullable.

#### Scenario: Versioning behaves like other entity tables
- **WHEN** a row is inserted with the permid of an existing head
- **THEN** the new row's `preceded_by_id` is set to that head and the head's `succeeded_by_id` is set to the new row

#### Scenario: The permid is an OCC permid
- **WHEN** an identification is inserted with a valid, registered `COL-…` permid, or with an unregistered `OCC-…` permid
- **THEN** PostgreSQL rejects the first with a check-constraint violation and the second with a foreign-key violation

#### Scenario: A taxon is not required
- **WHEN** an identification is inserted with `taxon_permid` NULL
- **THEN** the insert succeeds

#### Scenario: The taxon is a TXN permid
- **WHEN** an identification is inserted with a registered `COL-…` permid as `taxon_permid`
- **THEN** PostgreSQL rejects it with a check-constraint violation

#### Scenario: No swing FK to taxa
- **WHEN** the table's constraints are listed
- **THEN** none references `taxa`

#### Scenario: A reference is required
- **WHEN** an identification is inserted with `reference_id` NULL
- **THEN** the insert fails with a not-null violation

### Requirement: The root identification mints the occurrence
Every identification SHALL carry `occurrence_permid`, the permid of the occurrence it identifies. An identification whose
`occurrence_permid` equals its own `permid` is the root: it mints the occurrence, and the occurrence's permid is the root's
permid. Every other identification is a further identification of the occurrence its `occurrence_permid` names.

`collection_id` SHALL be set, and SHALL reference `collections`, on the root and on no other identification. `occurrence_permid` SHALL be
`text COLLATE "C"` with the `OCC` CHECK and a foreign key to the `permids` registry, and SHALL NOT be a foreign key to `identifications`,
because `permid` is not unique across versions.

#### Scenario: A root carries a collection
- **WHEN** an identification with `occurrence_permid` equal to its `permid` is inserted with `collection_id` NULL
- **THEN** the insert fails

#### Scenario: A non-root carries no collection
- **WHEN** an identification with `occurrence_permid` different from its `permid` is inserted with a `collection_id`
- **THEN** the insert fails

#### Scenario: A non-root names its root
- **WHEN** an identification is inserted with `occurrence_permid` set to a root's permid and `collection_id` NULL
- **THEN** the insert succeeds

#### Scenario: An unregistered occurrence is refused
- **WHEN** an identification is inserted whose `occurrence_permid` has no row in `permids`
- **THEN** PostgreSQL rejects it with a foreign-key violation
