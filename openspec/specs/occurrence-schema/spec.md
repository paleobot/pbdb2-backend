# occurrence-schema Specification

## Purpose
The target shape of the derived `occurrences` table: an unversioned cache, one row per occurrence, rebuilt from `identifications` (see `identification-schema` and `occurrence-derivation`). It requires a collection and a reference, keeps the legacy join key, and is indexed by taxon and collection. Schema only; the migration from classic `occurrences` and `reidentifications` is a separate capability.

## Requirements

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
