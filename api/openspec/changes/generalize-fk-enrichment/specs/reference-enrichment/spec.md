## ADDED Requirements

### Requirement: Links are declared per resource against a link-target registry

Relationship enrichment SHALL be declared as data on a resource's descriptor: a
map of output field name to a link declaration naming the **target route group**,
the column carrying the foreign key, and — for many-to-many links — the join
table and join key. The system SHALL resolve a target route group through a
registry supplying that group's backing table, JSONB payload column, and label
key.

The target's route-group name SHALL be the single identifier used both to select
the SQL source and to derive the `href` base, so the two cannot drift apart. The
registry SHALL contain `references` (backing table `refs`, payload column
`reference`, label key `title`) and `authorities` (backing table `authorities`,
payload column `authority`, label key `citation`).

A resource that declares no links SHALL be read exactly as before, with no
enrichment applied.

#### Scenario: A declared link resolves against its target group

- **WHEN** a resource declares a link naming a target route group and a foreign
  key column, and a resource with a live target row is read
- **THEN** the named output field is an object carrying that target's label,
  its `permid`, and an `href`
- **AND** the label is read from the target group's payload column at the
  target's label key

#### Scenario: An href is derived from the target's route group

- **WHEN** any enriched link object is returned
- **THEN** its `href` is the read URL of the target route group for that
  `permid`, derived from the citing group's mounted prefix and the target's
  group name

#### Scenario: A resource with no declared links is unenriched

- **WHEN** a resource whose descriptor declares no links is read
- **THEN** its `data` carries no enrichment fields and the read is otherwise
  unchanged

### Requirement: Links may be keyed by serial id or by permid

A link declaration SHALL state whether its foreign key column holds the target
row's internal serial id or the target lineage's `permid`. An id-keyed link SHALL
resolve by matching the target's internal id; a permid-keyed link SHALL resolve
by matching the target's `permid`, requiring no id-to-permid translation. Both
forms SHALL produce the same `{ <label>, permid, href }` object shape, and
neither SHALL expose an internal serial identifier.

#### Scenario: An id-keyed link resolves

- **WHEN** a resource declares an id-keyed link and is read
- **THEN** the target is resolved by its internal id
- **AND** no internal serial identifier appears in the response

#### Scenario: A permid-keyed link resolves

- **WHEN** a resource declares a permid-keyed link whose column holds a target
  `permid`, and is read
- **THEN** the target is resolved by matching that `permid`
- **AND** the resulting object has the same shape as an id-keyed link's

### Requirement: Suppression and href hydration apply to every link target

The soft-removal and HTTP-agnosticism rules established for references SHALL
apply to every declared link regardless of target. A link whose resolved target
row is soft-removed SHALL yield `null` for a single-valued link and SHALL be
omitted from a multi-valued link's array. The persistence layer SHALL emit only
`{ <label>, permid }` for every link, and `href` SHALL be added at the
route/envelope boundary from data already filtered for soft-removal, so no
`href` can point at a suppressed resource.

#### Scenario: A removed target is suppressed for any group

- **WHEN** a declared link's resolved target row is soft-removed, for any target
  route group
- **THEN** a single-valued link is `null`
- **AND** a multi-valued link omits that entry from its array

#### Scenario: The persistence layer emits no href for any link

- **WHEN** the read repository or the schema-tree read produces any link object
- **THEN** it yields the label and `permid` without an `href`
- **AND** the `href` is added only at the route/envelope boundary

## MODIFIED Requirements

### Requirement: Authority reads embed their reference

A read of an `authorities` resource (single or list item) SHALL include a
`reference` field resolved from the `authorities.reference_id` foreign key,
declared as an id-keyed link targeting the `references` route group. The value
SHALL be an object `{ title, permid, href }` where `title` is the referenced
`refs` row's `reference->>'title'`, `permid` is that row's `permid`, and `href`
is `/api/v1/references/{permid}`. When the referenced reference is soft-removed,
`reference` SHALL be `null`.

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
`collection_id`; `additional_schema_refs` keyed by `schema_id`). Both SHALL be
declared as id-keyed links targeting the `references` route group.
`primaryReference` SHALL be an object `{ title, permid, href }` of the same shape
as an authority's `reference`, or `null` when the primary reference is
soft-removed. `additionalReferences` SHALL be an array of those objects with
soft-removed references omitted; it SHALL be `[]` when there are none.

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

Enriched links SHALL be embedded as domain fields within `data` (not within the
envelope `links`), and each link object SHALL carry an `href` pointing at the
target lineage's read URL so the same object is navigable in both single reads
and list items. For links targeting the `references` group that URL is
`/api/v1/references/{permid}`. The `href` SHALL be hydrated at the route/envelope
boundary from the resolved `permid`; the persistence layer SHALL emit only the
label and `permid` and SHALL NOT construct URLs. Hydration SHALL derive `href`
only from link objects already filtered for soft-removal, so no `href` can point
at a suppressed resource.

#### Scenario: Reference objects carry a resolvable href

- **WHEN** any enriched reference object is returned
- **THEN** it includes `href` equal to `/api/v1/references/{permid}` for its
  `permid`

#### Scenario: Persistence layer is HTTP-agnostic

- **WHEN** the read repository or schema-tree read produces a reference
- **THEN** it yields `{ title, permid }` without an `href`
- **AND** the `href` is added only at the route/envelope boundary
