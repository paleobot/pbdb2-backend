# identification-schema Specification

## Purpose
The `identifications` table and its payload schema: each row is one scientist's identification of a fossil in a collection, modelled on `name_opinions`. The first identification of an occurrence mints it; every later one, including a reidentification, is a further statement about it. The current identification is derived elsewhere, never stored here.

## Requirements

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

### Requirement: Several identifications of one occurrence coexist and none is marked current
There SHALL be no reidentifications table and no column recording which identification is current. An occurrence MAY have any
number of identifications, including concurrent ones from different people and references; each is its own row with its own
`permid`, persons, reference, taxon and payload.

#### Scenario: Two identifications of one occurrence
- **WHEN** two non-root identifications naming the same root are inserted by different people citing different references
- **THEN** both are stored and neither is flagged as current

#### Scenario: No current flag
- **WHEN** the `identifications` columns are listed
- **THEN** none records whether the row is the current identification

### Requirement: The legacy join keys and creation time are preserved
The table SHALL carry `oldpbdb_occurrence_no` (set on every row) and `oldpbdb_reid_no` (set only on rows that came from a legacy
reidentification), SHALL index `oldpbdb_occurrence_no`, and SHALL let a migration set `created_at` to the legacy `created`
timestamp, including NULL.

#### Scenario: The join key is indexed
- **WHEN** the table's indexes are listed
- **THEN** one covers `oldpbdb_occurrence_no`

#### Scenario: A migration sets created_at explicitly
- **WHEN** a row is inserted with `created_at` NULL
- **THEN** the stored value is NULL, not the insert time

### Requirement: Lookups the derive and read paths need are indexed
The table SHALL have an index on `occurrence_permid` covering every version (the lineage's first-entry time reads them all), a
partial index on current versions only (`succeeded_by_id IS NULL`) for `taxon_permid`, and plain indexes on the `collection_id`
and `reference_id` foreign keys, which a new version of a collection or reference updates by old id.

#### Scenario: Head lookups use an index
- **WHEN** the table's indexes are listed
- **THEN** one covers `occurrence_permid` without a version predicate, one covers `taxon_permid` restricted to rows with `succeeded_by_id IS NULL`, and one each covers `collection_id` and `reference_id`

### Requirement: The identification payload schema keeps the names as written, with a resolution per rank
`payloadSchemas/identification.schema.js` SHALL export `identificationSource`, the annotated source for the jsonb payload, from
which every variant is derived. Its payload SHALL hold `identification` (an object with optional `genus`, `subgenus`, `species`
and `subspecies`, each an object with optional `resolution` and `name`), `plantOrgans` (an array of closed-enum values),
`comments`, and read-only `legacyIDs` (`oldpbdbID`, `oldpbdbReidID`). It SHALL NOT hold abundance. No property SHALL be required.

Resolutions SHALL be closed inline enums: the shared set `aff.`, `cf.`, `ex gr.`, `sensu lato`, `sensu stricto`, `?`, `"` and
`informal`, plus `n. gen.` for genus, `n. subgen.` for subgenus, `n. sp.` for species, and `n. ssp.`, `var`, `morph`, `forma` and
`mut` for subspecies. The empty string SHALL NOT be a valid resolution; "no resolution" is the absent key.

#### Scenario: Every variant compiles
- **WHEN** every variant of the identification source is derived and compiled in strict mode
- **THEN** each compiles

#### Scenario: A payload with no name validates
- **WHEN** the `db` variant validates `{}`
- **THEN** it passes

#### Scenario: The ditto mark is admitted
- **WHEN** a genus resolution is `"`
- **THEN** the `db` variant accepts it

#### Scenario: A resolution belongs to its rank
- **WHEN** a genus resolution is `n. sp.`
- **THEN** the `db` variant rejects it

#### Scenario: Abundance is not an identification field
- **WHEN** a payload contains `abundance`
- **THEN** the `db` variant rejects it

#### Scenario: Unknown keys are rejected
- **WHEN** a payload contains a key the schema does not declare
- **THEN** the `db` variant rejects it
