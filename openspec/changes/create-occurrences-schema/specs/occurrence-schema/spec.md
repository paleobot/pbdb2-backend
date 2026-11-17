## ADDED Requirements

### Requirement: Occurrences are a versioned table that links to its taxon by permid
The `occurrences` table SHALL be defined in `postgresql/02-core.sql` as a versioned entity table: a `bigint`
identity `id`, a uuidv7 `permid` enforced by the same CHECK as the other versioned tables, `authorizer_person_id`
and `enterer_person_id` referencing `persons`, an `occurrence` jsonb payload, the `preceded_by_id` /
`succeeded_by_id` / `removed` / `created_at` columns, and the standard version triggers installed through
`install_version_triggers`.

The taxon SHALL be carried as `taxon_permid uuid`, holding a `name_opinions` permid, and SHALL NOT be a foreign key
to `taxa`. It SHALL be nullable.

#### Scenario: Versioning behaves like other entity tables
- **WHEN** a row is inserted with the permid of an existing head
- **THEN** the new row's `preceded_by_id` is set to that head and the head's `succeeded_by_id` is set to the new row

#### Scenario: A taxon is not required
- **WHEN** an occurrence is inserted with `taxon_permid` NULL
- **THEN** the insert succeeds

#### Scenario: No swing FK to taxa
- **WHEN** the table's constraints are listed
- **THEN** none references `taxa`

### Requirement: A reidentification is another occurrence row linked to the one it supersedes
There SHALL be no separate reidentifications table. A reidentification SHALL be an `occurrences` row whose
`reidentifies_id` references the immediately preceding identification, forming a linked list from the first
identification (whose `reidentifies_id` is NULL) to the latest. `reidentifies_id` SHALL be an ordinary foreign key to
`occurrences(id)`, so that creating a new version of the preceding identification re-points it to that new version.

The table SHALL NOT carry a column recording which identification is current. The current identification is the
chain head, derived at read time.

#### Scenario: A chain is a linked list
- **WHEN** an occurrence, then a reidentification of it, then a reidentification of that are inserted, each pointing at the previous
- **THEN** each row after the first has `reidentifies_id` equal to the previous row's `id`, and the first row has it NULL

#### Scenario: Editing a prior identification keeps the chain connected
- **WHEN** a new version of a middle identification is inserted
- **THEN** the next identification's `reidentifies_id` is updated to the new version's `id`

#### Scenario: No current flag
- **WHEN** the `occurrences` columns are listed
- **THEN** none records whether the row is the current identification

### Requirement: An occurrence requires a collection and a reference
`collection_id` and `reference_id` SHALL be `NOT NULL` foreign keys to `collections` and `refs`. An occurrence
has no meaning outside its collection.

#### Scenario: An occurrence without a collection is rejected
- **WHEN** an occurrence is inserted with `collection_id` NULL
- **THEN** the insert fails with a not-null violation

#### Scenario: An occurrence without a reference is rejected
- **WHEN** an occurrence is inserted with `reference_id` NULL
- **THEN** the insert fails with a not-null violation

### Requirement: The legacy join keys and creation time are preserved
The table SHALL carry `oldpbdb_occurrence_no` and `oldpbdb_reid_no` (the latter set only on rows that came from a
legacy reidentification), and SHALL index `oldpbdb_occurrence_no`. `created_at` SHALL be a column that a migration may set
to the legacy `created` timestamp.

#### Scenario: The join key is indexed
- **WHEN** the table's indexes are listed
- **THEN** one covers `oldpbdb_occurrence_no`

### Requirement: Lookups the write and read paths need are indexed
The table SHALL have partial indexes on current versions only (`succeeded_by_id IS NULL`) for `taxon_permid` and
`collection_id`, and a full index on `reidentifies_id`, because the version-swing function updates that column by old
`id` across every version.

#### Scenario: Swing lookups use an index
- **WHEN** the table's indexes are listed
- **THEN** one covers `reidentifies_id` without a `succeeded_by_id IS NULL` predicate

### Requirement: The occurrence payload schema keeps the names as written, with a resolution per rank
`payloadSchemas/occurrence.schema.js` SHALL export `occurrenceSource`, the annotated source for the jsonb payload, from
which every variant is derived. Its payload SHALL hold `identification` (an object with optional `genus`, `subgenus`,
`species` and `subspecies`, each an object with optional `resolution` and `name`), `abundance` (`value`, `unit`),
`plantOrgans` (an array of closed-enum values), `comments`, and read-only `legacyIDs` (`oldpbdbID`, `oldpbdbReidID`).
No property SHALL be required.

Resolutions SHALL be closed inline enums: the shared set `aff.`, `cf.`, `ex gr.`, `sensu lato`, `sensu stricto`, `?`,
`"` and `informal`, plus `n. gen.` for genus, `n. subgen.` for subgenus, `n. sp.` for species, and `n. ssp.`, `var`,
`morph`, `forma` and `mut` for subspecies. The empty string SHALL NOT be a valid resolution; "no resolution" is the absent key.

#### Scenario: Every variant compiles
- **WHEN** every variant of the occurrence source is derived and compiled in strict mode
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

#### Scenario: Unknown keys are rejected
- **WHEN** a payload contains a key the schema does not declare
- **THEN** the `db` variant rejects it
