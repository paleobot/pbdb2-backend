# reference-enrichment

## Purpose

Read responses for resources that cite references SHALL embed those references —
resolved from foreign keys into `refs` — as `{ title, permid, href }` objects in
`data`. `authorities` carry a single `reference`; `collections` and `schemas`
carry a `primaryReference` and an `additionalReferences` array. This is the
first slice of relationship enrichment; `specimens` follows the same primary +
additional pattern once it has a backing table.

## Requirements

### Requirement: Authority reads embed their reference

A read of an `authorities` resource (single or list item) SHALL include a
`reference` field resolved from the `authorities.reference_id` foreign key. The
value SHALL be an object `{ title, permid, href }` where `title` is the
referenced `refs` row's `reference->>'title'`, `permid` is that row's `permid`,
and `href` is `/api/v1/references/{permid}`. When the referenced reference is
soft-removed, `reference` SHALL be `null`.

#### Scenario: Authority single read includes its reference

- **WHEN** an authority with a live referenced `refs` row is read by `permid`
- **THEN** `data.reference` is `{ title, permid, href }`
- **AND** `title` is the referenced row's `reference->>'title'`
- **AND** `permid` is the referenced lineage's `permid`
- **AND** `href` is `/api/v1/references/{permid}`

#### Scenario: Authority list items include their reference

- **WHEN** the authorities list is read
- **THEN** each item in `data` carries the same `reference` object shape

#### Scenario: Removed authority reference is suppressed

- **WHEN** an authority's referenced `refs` head is soft-removed
- **THEN** `data.reference` is `null`

### Requirement: Collection and schema reads embed primary and additional references

A read of a `collections` or `schemas` resource (single or list item) SHALL
include a `primaryReference` field resolved from the main table's
`reference_id`, and an `additionalReferences` array resolved from the resource's
additional-references join table (`additional_collection_refs` keyed by
`collection_id`; `additional_schema_refs` keyed by `schema_id`). `primaryReference`
SHALL be an object `{ title, permid, href }` of the same shape as an authority's
`reference`, or `null` when the primary reference is soft-removed.
`additionalReferences` SHALL be an array of those objects with soft-removed
references omitted; it SHALL be `[]` when there are none.

#### Scenario: Collection read includes primary and additional references

- **WHEN** a collection with a primary reference and two additional references
  is read by `permid`
- **THEN** `data.primaryReference` is `{ title, permid, href }`
- **AND** `data.additionalReferences` is an array of two `{ title, permid, href }`
  objects

#### Scenario: Schema read includes primary and additional references

- **WHEN** a schema with a primary reference and additional references is read by
  `permid`
- **THEN** `data.primaryReference` and `data.additionalReferences` are present
  with the same shapes
- **AND** the schema's nested characters and states are unchanged

#### Scenario: No additional references yields an empty array

- **WHEN** a collection or schema has a primary reference but no additional
  references
- **THEN** `data.additionalReferences` is `[]`

#### Scenario: Removed references are suppressed

- **WHEN** a collection's or schema's primary reference is soft-removed, or any
  of its additional references is soft-removed
- **THEN** the soft-removed primary resolves to `null`
- **AND** soft-removed additional references are omitted from
  `data.additionalReferences`

### Requirement: Enriched references are embedded in data with a navigable href

Enriched references SHALL be embedded as domain fields within `data` (not within
the envelope `links`), and each reference object SHALL carry an `href` pointing
at the referenced lineage's read URL (`/api/v1/references/{permid}`) so the same
object is navigable in both single reads and list items. The `href` SHALL be
hydrated at the route/envelope boundary from the resolved `permid`; the
persistence layer SHALL emit only `{ title, permid }` and SHALL NOT construct
URLs. Hydration SHALL derive `href` only from references already filtered for
soft-removal, so no `href` can point at a suppressed reference.

#### Scenario: Reference objects carry a resolvable href

- **WHEN** any enriched reference object is returned
- **THEN** it includes `href` equal to `/api/v1/references/{permid}` for its
  `permid`

#### Scenario: Persistence layer is HTTP-agnostic

- **WHEN** the read repository or schema-tree read produces a reference
- **THEN** it yields `{ title, permid }` without an `href`
- **AND** the `href` is added only at the route/envelope boundary

### Requirement: References resolve to the current head of the referenced lineage

Reference resolution SHALL read `title` and `permid` directly from the row a
resource's `reference_id` (and its additional-references join rows) point at,
yielding the current head's `title` and the lineage's stable `permid` without
separate version resolution. This is sound because the backend version triggers
swing inbound foreign keys to the new head on every re-version, so those FKs
always point at the current head of the referenced lineage.

#### Scenario: Edited reference is reflected on re-read

- **WHEN** a referenced reference is edited (a new version is created) and the
  citing resource is read again
- **THEN** the embedded reference's `title` reflects the new head version
- **AND** its `permid` is unchanged

#### Scenario: Edited citing resource retains its additional references

- **WHEN** a collection or schema is edited (a new version is created) and read
  again
- **THEN** its `additionalReferences` are still present, resolved via the join
  table swung to the new head

### Requirement: Stub reads expose the enriched shape

The stubbed `authorities`, `collections`, and `schemas` responses SHALL include
the same reference fields (`reference`, or `primaryReference` +
`additionalReferences`) when no PostgreSQL connection is configured and reads
fall back to stub data, so the response shape is identical whether or not a
database is present.

#### Scenario: Stub authority carries a reference field

- **WHEN** authorities are read with no database configured
- **THEN** the stub `data` includes a `reference` object of the enriched shape

#### Scenario: Stub collection and schema carry primary and additional references

- **WHEN** collections or schemas are read with no database configured
- **THEN** the stub `data` includes `primaryReference` and `additionalReferences`
  fields of the enriched shape
