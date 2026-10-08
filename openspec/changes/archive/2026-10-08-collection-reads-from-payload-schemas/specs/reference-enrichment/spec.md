## MODIFIED Requirements

### Requirement: Links are declared per resource against a link-target registry

Relationship enrichment SHALL be declared in one of two ways:
- **In the resource's payload source**, by a property built with the `link` helper
  (`x-link: { target, label }`), or by an array property whose `items` are built
  with it, for a resource that reads through its source (`data-access`). The codec
  named by the property's `x-storage` resolves the link, and the label is read from
  the codec's source.
- **As data on the resource's descriptor**, for every other resource: a map of
  output field name to a link declaration naming the **target route group**, the
  column carrying the foreign key, and — for many-to-many links — the join table
  and join key. The system SHALL resolve a target route group through a registry
  supplying that group's backing table, its label source, and the label's name.

Either way, the target's route-group name SHALL be the single identifier used to
derive the `href` base. For descriptor links it also selects the SQL source, so the
two cannot drift apart. The registry SHALL contain `references` (backing table
`refs`, label at JSONB payload key `title` in column `reference`), `authorities`
(backing table `authorities`, label at JSONB payload key `citation` in column
`authority`), and `taxa` (backing table `taxa`, label at plain column `name`).

A resource that declares no links SHALL be read exactly as before, with no
enrichment applied.

#### Scenario: A declared link resolves against its target group

- **WHEN** a resource declares a link naming a target route group and a foreign
  key column, and a resource with a live target row is read
- **THEN** the named output field is an object carrying that target's label,
  its `permid`, and an `href`
- **AND** the label is read from the target group's declared label source

#### Scenario: A source link resolves through its codec

- **WHEN** a resource reading through its payload source has a property declared
  with `link({ target: "references", label: "title" })`
- **THEN** that field is an object carrying the reference's `title` and `permid`,
  resolved by the property's codec, plus an `href` into the `references` group

#### Scenario: Source link items resolve through their codec

- **WHEN** a resource reading through its payload source has an array property
  whose `items` are `link({ target: "references", label: "title" })`
- **THEN** each item is an object carrying the reference's `title` and `permid`,
  resolved by the array's codec, plus an `href` into the `references` group

#### Scenario: An href is derived from the target's route group

- **WHEN** any enriched link object is returned
- **THEN** its `href` is the read URL of the target route group for that
  `permid`, derived from the citing group's mounted prefix and the target's
  group name

#### Scenario: A self-referential link resolves within one group

- **WHEN** a resource declares a permid-keyed link whose target is its own route
  group
- **THEN** the link resolves against that same table
- **AND** its `href` points into that same group

#### Scenario: A resource with no declared links is unenriched

- **WHEN** a resource whose descriptor declares no links is read
- **THEN** its `data` carries no enrichment fields and the read is otherwise
  unchanged

### Requirement: Suppression and href hydration apply to every link target

The soft-removal and HTTP-agnosticism rules established for references SHALL
apply to every link, however it is declared and whatever its target. A link whose
resolved target row is soft-removed SHALL yield `null` for a single-valued link
and SHALL be omitted from a multi-valued link's array. The persistence layer SHALL
emit only `{ <label>, permid }` for every link, and `href` SHALL be added at the
route/envelope boundary from data already filtered for soft-removal, so no `href`
can point at a suppressed resource. For a source link, the boundary SHALL find the
links by the source's root properties that carry `x-link` (adding `href` to the
value) or whose `items` carry it (adding `href` to each item of the array).

#### Scenario: A removed target is suppressed for any group

- **WHEN** a declared link's resolved target row is soft-removed, for any target
  route group
- **THEN** a single-valued link is `null`
- **AND** a multi-valued link omits that entry from its array

#### Scenario: The persistence layer emits no href for any link

- **WHEN** the read repository or the schema-tree read produces any link object
- **THEN** it yields the label and `permid` without an `href`
- **AND** the `href` is added only at the route/envelope boundary

#### Scenario: Link items are hydrated

- **WHEN** a collection with two additional references is read
- **THEN** each `additionalReferences` item carries `href` equal to
  `/api/v1/references/{permid}`

### Requirement: Collection and schema reads embed primary and additional references

A read of a `collections` or `schemas` resource (single or list item) SHALL
include a `primaryReference` field resolved from the main table's
`reference_id`, and an `additionalReferences` array resolved from the resource's
additional-references child table (`additional_collection_refs` keyed by
`collection_id`; `additional_schema_refs` keyed by `schema_id`).

How they are declared differs between the two:
- **Collections** declare them in the collection payload source.
  `primaryReference` is `link({ target: "references", label: "title" })`,
  resolved by `referencePermid`. `additionalReferences` is an array of those
  links, resolved by `referenceLinks`. Collections SHALL declare no descriptor
  `links`.
- **Schemas** declare them as id-keyed descriptor links targeting the
  `references` route group.

For both, `primaryReference` SHALL be an object `{ title, permid, href }` of the
same shape as an authority's `reference`, or `null` when the primary reference is
soft-removed. The `title` key is left out when the reference has none.
`additionalReferences` SHALL be an array of those objects with soft-removed
references omitted, and it SHALL be `[]` when there are none.

`additionalReferences` SHALL be unordered, and SHALL carry one object per stored
child row. A row citing the primary reference SHALL be returned like any other,
so the primary usually appears in both fields: Classic's `secondary_refs`, which
the child table copies, lists it there. Whether that changes awaits the
collection reference model (`docs/api-design-backlog.md`).

#### Scenario: Collection read includes primary and additional references

- **WHEN** a collection with a primary reference and two additional references
  is read by `permid`
- **THEN** `data.primaryReference` is `{ title, permid, href }`
- **AND** `data.additionalReferences` is an array of two `{ title, permid, href }`
  objects

#### Scenario: The primary repeats as stored

- **WHEN** a collection's child rows include one citing its primary reference
- **THEN** that reference appears both as `data.primaryReference` and as an item
  of `data.additionalReferences`

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

### Requirement: Stub reads expose the enriched shape

The stubbed `authorities`, `collections`, and `schemas` responses SHALL include
the same reference fields (`reference`, or `primaryReference` +
`additionalReferences`) when no PostgreSQL connection is configured and reads
fall back to stub data, so the response shape is identical whether or not a
database is present. The `authorities` and `collections` stubs SHALL be payloads
in their sources' shapes, carrying only fields their sources declare.

#### Scenario: Stub authority carries a reference field

- **WHEN** authorities are read with no database configured
- **THEN** the stub `data` includes a `reference` object of the enriched shape
- **AND** it carries no field the authority source does not declare

#### Scenario: Stub collection and schema carry primary and additional references

- **WHEN** collections or schemas are read with no database configured
- **THEN** the stub `data` includes `primaryReference` and `additionalReferences`
  fields of the enriched shape

#### Scenario: Stub collection follows its source

- **WHEN** collections are read with no database configured
- **THEN** the stub `data` carries its country and state under
  `location.toponym.administrativeArea`, not as top-level `country` and `state`
- **AND** it carries no field the collection source does not declare
