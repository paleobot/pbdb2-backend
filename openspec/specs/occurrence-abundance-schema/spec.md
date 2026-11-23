# occurrence-abundance-schema Specification

## Purpose
The `occurrence_abundances` table and payload schema: how many specimens or individuals were recorded for an occurrence, held apart from the identification so the count has its own provenance and an occurrence can be re-identified without touching it.

## Requirements

### Requirement: Abundances are a versioned table keyed by occurrence permid
The `occurrence_abundances` table SHALL be defined in `db/02-core.sql` as a versioned entity table: a `bigint` identity `id`, a
uuidv7 `permid` enforced by the same CHECK as the other versioned tables, `authorizer_person_id` and `enterer_person_id`
referencing `persons`, `occurrence_permid uuid NOT NULL`, `reference_id` referencing `refs` and NOT NULL, an `abundance` jsonb
payload, the `preceded_by_id` / `succeeded_by_id` / `removed` / `created_at` columns, and the standard version triggers. No foreign
key SHALL be declared on `occurrence_permid`.

#### Scenario: Versioning behaves like other entity tables
- **WHEN** a row is inserted with the permid of an existing head
- **THEN** the new row's `preceded_by_id` is set to that head and the head's `succeeded_by_id` is set to the new row

#### Scenario: Provenance is its own
- **WHEN** an abundance row is inserted with an authorizer, enterer and reference different from the occurrence's root
- **THEN** the insert succeeds

### Requirement: An occurrence has at most one current abundance
At most one lineage (one `permid`, hence one head) SHALL exist per `occurrence_permid`, enforced by the table. A new version of that lineage SHALL be accepted.

#### Scenario: A second lineage for one occurrence is rejected
- **WHEN** two abundance rows with different `permid` and the same `occurrence_permid` are inserted
- **THEN** the second insert fails

#### Scenario: A new version replaces the head
- **WHEN** a row is inserted with the permid of the existing head
- **THEN** the insert succeeds and the previous row is no longer a head

### Requirement: The abundance payload schema holds a value and a unit
`payloadSchemas/occurrenceAbundance.schema.js` SHALL export `occurrenceAbundanceSource`, the annotated source for the jsonb payload,
from which every variant is derived. Its payload SHALL hold `value` and `unit`, both strings, and read-only `permid` and `legacyIDs` (`oldpbdbID`). No property
SHALL be required.

#### Scenario: Every variant compiles
- **WHEN** every variant of the abundance source is derived and compiled in strict mode
- **THEN** each compiles

#### Scenario: A value and unit validate
- **WHEN** the `db` variant validates `{"value": "3", "unit": "specimens"}`
- **THEN** it passes

#### Scenario: A number is rejected
- **WHEN** `value` is the number 3
- **THEN** the `db` variant rejects it

### Requirement: The derived occurrence does not carry abundance
The derived `occurrences` table SHALL NOT have an abundance column; abundance is read from `occurrence_abundances` by `occurrence_permid`.

#### Scenario: No abundance column on occurrences
- **WHEN** the `occurrences` columns are listed
- **THEN** none holds abundance
