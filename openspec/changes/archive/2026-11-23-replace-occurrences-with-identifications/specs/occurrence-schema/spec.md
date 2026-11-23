## ADDED Requirements

### Requirement: Occurrences are a derived, unversioned cache
The `occurrences` table SHALL be defined as a plain, unversioned table with a `bigint` identity `id`, a `permid` that is UNIQUE and
equals its root identification's permid, `collection_id`, `reference_id`, `taxon_permid`, an `identification` jsonb column holding the
winning identification's name block, a `plant_organs` column, `winning_identification_id`, `removed` and `created_at`. It SHALL NOT
have the `preceded_by_id` / `succeeded_by_id` version columns and SHALL NOT be written to by the application: its contents are derived
from `identifications` (see the `occurrence-derivation` capability).

#### Scenario: The cache is not versioned
- **WHEN** the `occurrences` columns are listed
- **THEN** neither `preceded_by_id` nor `succeeded_by_id` is among them

#### Scenario: One row per permid
- **WHEN** two rows are inserted with the same `permid`
- **THEN** the second insert fails with a unique violation

#### Scenario: The winning identification is recorded
- **WHEN** the table's columns are listed
- **THEN** `winning_identification_id` references `identifications`

### Requirement: The derived occurrences are indexed by taxon and collection
The `occurrences` table SHALL have plain indexes on `taxon_permid` and `collection_id`. The table keeps no history, so there is no
head predicate to restrict them to.

#### Scenario: Lookups use an index
- **WHEN** the table's indexes are listed
- **THEN** one covers `taxon_permid` and one covers `collection_id`

## MODIFIED Requirements

### Requirement: An occurrence requires a collection and a reference
`collection_id` and `reference_id` SHALL be `NOT NULL` foreign keys to `collections` and `refs`, on the derived `occurrences` row and
on its root identification. An occurrence has no meaning outside its collection.

#### Scenario: An occurrence without a collection is rejected
- **WHEN** an occurrence is inserted with `collection_id` NULL
- **THEN** the insert fails with a not-null violation

#### Scenario: An occurrence without a reference is rejected
- **WHEN** an occurrence is inserted with `reference_id` NULL
- **THEN** the insert fails with a not-null violation

### Requirement: The legacy join keys and creation time are preserved
The `occurrences` table SHALL carry `oldpbdb_occurrence_no` (the root's), SHALL index it, and SHALL carry a `created_at` that the
derivation sets to the first-entry time of the root's lineage. The legacy reidentification number lives only on `identifications`.

#### Scenario: The join key is indexed
- **WHEN** the table's indexes are listed
- **THEN** one covers `oldpbdb_occurrence_no`

#### Scenario: Creation time follows the root
- **WHEN** an occurrence is derived from a root whose first version's `created_at` is T
- **THEN** the occurrence row's `created_at` is T

## REMOVED Requirements

### Requirement: Occurrences are a versioned table that links to its taxon by permid
**Reason**: `occurrences` is now a derived cache; the versioned table is `identifications`.
**Migration**: See `identification-schema`, "Identifications are a versioned table that links to its taxon by permid".

### Requirement: A reidentification is another occurrence row linked to the one it supersedes
**Reason**: A reidentification is now a non-root row of `identifications` pointing at its root by `occurrence_permid`; there is no
`reidentifies_id` chain.
**Migration**: See `identification-schema`, "The root identification mints the occurrence" and "Several identifications of one occurrence coexist and none is marked current".

### Requirement: The occurrence payload schema keeps the names as written, with a resolution per rank
**Reason**: The payload moves to the identification (names, organs, comments) and to the abundance table (value, unit).
**Migration**: See `identification-schema`, "The identification payload schema keeps the names as written, with a resolution per rank", and `occurrence-abundance-schema`.

### Requirement: Lookups the write and read paths need are indexed
**Reason**: The requirement existed to back the version-swing update of `reidentifies_id`, which no longer exists, and its
current-version-only indexes belong to a versioned table.
**Migration**: See "The derived occurrences are indexed by taxon and collection" here, and `identification-schema`, "Lookups the derive and read paths need are indexed".
