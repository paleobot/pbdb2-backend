## ADDED Requirements

### Requirement: Read occurrences and reidentifications from MariaDB in two ordered streams
`src/occurrences-migration/migrate-occurrences.js` SHALL read the Classic tables in two passes, each streamed
without buffering the full result set:

1. `occurrences`, ordered by `occurrence_no ASC`, selecting `occurrence_no`, `collection_no`, `reference_no`,
   `taxon_no`, `authorizer_no`, `enterer_no`, the four `*_reso`/`*_name` pairs (genus, subgenus, species,
   subspecies), `plant_organ`, `plant_organ2`, `abund_value`, `abund_unit` and `comments`;
2. `reidentifications`, ordered by `reid_no ASC`, selecting `reid_no`, `occurrence_no`, `collection_no`,
   `reference_no`, `taxon_no`, `authorizer_no`, `enterer_no`, the four `*_reso`/`*_name` pairs, `plant_organ`
   and `comments`.

The script SHALL NOT read `occurrences.reid_no`, `reidentifications.most_recent`, `created`, `modified`,
`updated`, `modified_temp`, `modifier_no`, `updater_no`, `upload`, `upload_id`, or the denormalized
`authorizer`/`enterer`/`modifier` name columns. It SHALL log each pass's source row count.

#### Scenario: Both passes are ordered by the Classic number
- **WHEN** the script runs against `pbdb_2026_10_18`
- **THEN** it streams 2,011,484 occurrences in `occurrence_no` order, then 35,492 reidentifications in `reid_no` order

#### Scenario: Classic's current-identification caches are not read
- **WHEN** the source queries are built
- **THEN** neither selects `occurrences.reid_no` nor `reidentifications.most_recent`, so no row is treated as current at load time

#### Scenario: Classic timestamps are not read
- **WHEN** the source queries are built
- **THEN** neither selects `created`, `modified` or `updated`

### Requirement: Treat `0` and NULL as one condition on every legacy foreign-key column
The script SHALL treat `0` and SQL NULL identically in every test of whether `collection_no`,
`reference_no`, `taxon_no`, `authorizer_no`, `enterer_no` or a reidentification's `occurrence_no` is set.

#### Scenario: Unset taxon in either spelling
- **WHEN** one occurrence has `taxon_no = 0` and another has `taxon_no IS NULL`
- **THEN** both are loaded with a NULL `taxon_permid`, and neither is reported as an orphan taxon

### Requirement: Load one root identification per occurrence whose collection exists in PostgreSQL
The script SHALL insert one `identifications` row for each Classic occurrence whose `collection_no`
resolves to a `collections` head through `collection->'legacyIDs'->>'oldpbdbID'`, with:
- `permid` = `occurrence_permid` = `OCC-<occurrence_no>-<CC>`;
- `collection_id` = the resolved collection;
- `reference_id`, `taxon_permid`, `authorizer_person_id` and `enterer_person_id` resolved by the rules below;
- `identification` = the identification payload built from the row;
- `oldpbdb_occurrence_no` = `occurrence_no`; `oldpbdb_reid_no` NULL.

#### Scenario: A root identifies itself
- **WHEN** occurrence 12345 in a migrated collection is loaded
- **THEN** its row has `permid = occurrence_permid = 'OCC-12345-35'`, a non-NULL `collection_id`, and `oldpbdb_reid_no` NULL

### Requirement: Load one non-root identification per reidentification of a loaded occurrence
For each Classic reidentification whose `occurrence_no` was loaded as a root, the script SHALL insert one
`identifications` row with a permid minted from the `OCC` sequence, `occurrence_permid` = the root's permid,
`collection_id` NULL, its own reference, taxon and persons resolved by the rules below, the identification
payload built from the reidentification, `oldpbdb_occurrence_no` = its `occurrence_no`, and `oldpbdb_reid_no`
= `reid_no`. The reidentification's own `collection_no` SHALL NOT be written.

#### Scenario: A reidentification points at its root
- **WHEN** reidentification `reid_no` 7 of occurrence 12345 is loaded
- **THEN** its `occurrence_permid` is `'OCC-12345-35'`, its `permid` is a sequence permid of at least `OCC-10000000`, and its `collection_id` is NULL

#### Scenario: `reid_no` is never a permid number
- **WHEN** any reidentification is loaded
- **THEN** its permid number is drawn from the `OCC` sequence, because `reid_no` 1–43,526 overlaps `occurrence_no`

### Requirement: Excluded rows are decided against PostgreSQL and must match the curator list
An occurrence SHALL be excluded when its `collection_no` is unset or does not resolve to a PostgreSQL
`collections` head. A reidentification SHALL be excluded when its occurrence was not loaded as a root. The
script SHALL record every excluded row and, before committing, compare the set of `(source_table, source_no)`
pairs with the rows of the repository's `docs/occurrences-excluded.csv`. Any row in one set and not the other
SHALL fail the run, printing the differences, and nothing SHALL be committed.

#### Scenario: A collection Classic has but PostgreSQL does not
- **WHEN** an occurrence names collection 27182, which exists in Classic and was not migrated
- **THEN** the occurrence is excluded rather than aborting the run on the NOT NULL `collection_id`, and it is listed in the CSV

#### Scenario: Expected exclusions on the current dump
- **WHEN** the script runs against `pbdb_2026_10_18`
- **THEN** it excludes 626 occurrences and 15 reidentifications, and they are exactly the rows the CSV lists

#### Scenario: A new dump changes the excluded set
- **WHEN** the source contains an excluded occurrence the CSV does not list
- **THEN** the run fails before COMMIT, names the occurrence, and writes nothing

### Requirement: Collection conflicts are logged and must match the curator list
When a loaded reidentification's `collection_no` differs from its occurrence's, the script SHALL load the
reidentification normally, record the pair in the anomaly log with both collections, and, before committing,
compare the set of `(occurrence_no, reid_no)` pairs with `docs/occurrences-collection-conflicts.csv`. A
difference SHALL fail the run as for exclusions.

#### Scenario: The twelve conflicts
- **WHEN** the script runs against `pbdb_2026_10_18`
- **THEN** it logs 12 collection conflicts, including reidentification 19518 of occurrence 558371 (collection 122362 vs. 57958), and they match the CSV

### Requirement: Permids are registered or minted in a fixed order
- Root permids SHALL be registered from `occurrence_no` with `register_permids('OCC', …)`, once per batch.
- Abundance permids SHALL be minted with `mint_permids('ABD', n)` once per batch and assigned in `occurrence_no`
  order.
- Non-root permids SHALL be minted with `mint_permids('OCC', n)` once per batch and assigned in `reid_no` order.
- A non-root's `occurrence_permid` SHALL be computed in SQL (`format_permid('OCC', occurrence_no)`), not by
  JavaScript code.

Two runs from `--createdb` against the same dump SHALL produce identical permids on every row.

#### Scenario: First minted numbers
- **WHEN** a full run completes on an empty database
- **THEN** the abundance of the lowest-numbered occurrence with an abundance is `ABD-10000000-93`, and the lowest-numbered loaded reidentification is `OCC-10000000-29`

#### Scenario: Deterministic rebuild
- **WHEN** the database is rebuilt from `--createdb` and the step runs again against the same dump
- **THEN** every `identifications` and `occurrence_abundances` row has the permid it had before

### Requirement: `created_at` is not carried, and load order is the winner tie-break
The script SHALL NOT write `created_at` on any row, leaving the column default. It SHALL load every root before
any non-root, roots in `occurrence_no` order and non-roots in `reid_no` order, within one transaction, so that
every migrated identification has the same `created_at` and `derive_occurrences()`'s tie-break falls to the
lineage's first id in Classic number order.

#### Scenario: Same-year tie goes to the later reidentification
- **WHEN** an occurrence has two reidentifications citing references of the same year
- **THEN** the derived winner is the one with the higher `reid_no`, as Classic's `setMostRecentReID` picks

#### Scenario: One shared timestamp
- **WHEN** the step has committed
- **THEN** `SELECT count(DISTINCT created_at) FROM identifications` is 1

### Requirement: References resolve, with fallbacks, or the run aborts
A root's `reference_id` SHALL be its own `reference_no` resolved through `refs`
`reference->'legacyIDs'->>'oldpbdbID'`; when that is unset or unresolved, the collection's `reference_id`. A
non-root's SHALL be its own, or else its root's. A row with no reference after its fallback SHALL abort the run.
Each fallback SHALL be counted and logged.

#### Scenario: Root reference falls back to the collection
- **WHEN** a loaded occurrence has `reference_no = 0`
- **THEN** its root takes its collection's `reference_id`, and the fallback is counted (13 on `pbdb_2026_10_18`)

### Requirement: Taxa resolve to name permids or to NULL
`taxon_permid` SHALL be the `name_opinions` permid whose `oldpbdb_taxon_no` equals `taxon_no`
(`loadNamePermidMap()`), for roots and non-roots alike. An unset `taxon_no` SHALL give NULL. A set `taxon_no`
with no matching name opinion SHALL give NULL and an anomaly-log entry, and SHALL NOT abort the run; the
verbatim name is kept in the payload either way.

#### Scenario: Orphan taxon number
- **WHEN** an occurrence's `taxon_no` has no name opinion
- **THEN** it loads with `taxon_permid` NULL, its genus and species names in the payload, and one anomaly entry (10 such occurrences on `pbdb_2026_10_18`)

### Requirement: Persons resolve through the shared 0-sentinel rule
`authorizer_person_id` and `enterer_person_id` SHALL be resolved with `resolvePersons()` from `src/lib/identity.js`,
from the row's own `authorizer_no` and `enterer_no`. A reidentification SHALL NOT inherit its occurrence's persons.

#### Scenario: Reidentification keeps its own enterer
- **WHEN** a reidentification was entered by a different person from its occurrence
- **THEN** its `enterer_person_id` is that person, not the occurrence's enterer

### Requirement: Identification payloads are built by an exported pure function and validated
`buildIdentificationPayload` SHALL be exported and SHALL build the payload from one source row:
- `legacyIDs.oldpbdbID` = `occurrence_no` as a string, and on a reidentification `legacyIDs.oldpbdbReidID` =
  `reid_no` as a string;
- `identification.<rank>.resolution` and `.name` from `<rank>_reso` and `<rank>_name` for genus, subgenus,
  species and subspecies, each key omitted when NULL or `''`, and a rank omitted when both are;
- the ditto mark `"` kept verbatim;
- `plantOrgans` from `plant_organ` then `plant_organ2` (occurrences) or `plant_organ` (reidentifications), with
  NULL and `''` dropped, the key omitted when empty;
- `comments`, omitted when NULL or `''`;
- NUL bytes stripped from every string.

Each payload SHALL be validated against the identification source's resolved `db` variant before its batch
is inserted. A failure SHALL abort the run, printing the row's Classic number, the payload and the ajv errors.

#### Scenario: Empty resolution omitted, ditto kept
- **WHEN** a row has `genus_reso = ''`, `genus_name = 'Acrodus'` and `species_reso = '"'`
- **THEN** the payload has `identification.genus = {name: 'Acrodus'}` and `identification.species.resolution = '"'`

#### Scenario: Two organs in source order
- **WHEN** an occurrence has `plant_organ = 'leaf'` and `plant_organ2 = 'seed/fruit'`
- **THEN** `plantOrgans` is `['leaf', 'seed/fruit']`

### Requirement: One abundance row per loaded occurrence that records a count
For each loaded occurrence whose `abund_value` or `abund_unit` is non-empty after trimming, the script SHALL
insert one `occurrence_abundances` row with an `ABD` permid, `occurrence_permid` = the root's permid, the
root's resolved persons and `reference_id` (fallback included), and an `abundance` payload built by an exported
`buildAbundancePayload`: `legacyIDs.oldpbdbID` = `occurrence_no` as a string, `value` and `unit` as trimmed
text, each omitted when empty. Each payload SHALL be validated against the occurrence-abundance `db` variant.
Reidentifications SHALL produce no abundance rows.

#### Scenario: Unit without value is kept
- **WHEN** an occurrence has `abund_value = ''` and `abund_unit = 'specimens'`
- **THEN** an abundance row is written with `unit` and no `value`

#### Scenario: Expected abundance count
- **WHEN** the script runs against `pbdb_2026_10_18`
- **THEN** it writes one abundance row for each loaded occurrence with a value or unit (808,849 among occurrences whose collection exists in Classic, less any in collection 27182)

### Requirement: One transaction, the derive, and count assertions
The script SHALL write every row, and call `rebuild_occurrences()` once after the second pass, inside one
PostgreSQL transaction. Before COMMIT it SHALL assert:
- roots inserted + occurrences excluded = occurrences read;
- non-roots inserted + reidentifications excluded = reidentifications read;
- abundance rows = loaded occurrences with a non-empty value or unit;
- `occurrences` row count = roots inserted.

A failed assertion, CSV comparison, validation or insert SHALL roll the transaction back and exit non-zero.
`--dry-run` SHALL do everything except COMMIT, and roll back.

#### Scenario: The derived cache is filled in the same run
- **WHEN** the step commits
- **THEN** `occurrences` holds one row per root identification, each with a `winning_identification_id`

#### Scenario: Failure leaves nothing behind
- **WHEN** a payload fails validation in the second pass
- **THEN** the transaction is rolled back, and `identifications`, `occurrence_abundances`, `occurrences` and the `OCC`/`ABD` registry rows are all as they were before the step

#### Scenario: Dry run
- **WHEN** the script runs with `--dry-run`
- **THEN** it reads, builds, validates, inserts, derives and asserts, then rolls back and reports that nothing was written

### Requirement: The script reports what it did
At the end of a run the script SHALL print the source counts, the rows inserted per table, the exclusions by
category, the collection conflicts, the reference fallbacks, the unset and orphan taxa, the persons sentinel
count, and the anomaly count, and SHALL write anomalies through `createAnomalyLog`.

#### Scenario: Summary on success
- **WHEN** a run commits
- **THEN** its output includes the number of roots, non-roots and abundance rows inserted, and the number of `occurrences` rows derived
