## MODIFIED Requirements

### Requirement: Links are declared per resource against a link-target registry

Relationship enrichment SHALL be declared in one of two ways:
- **In the resource's payload source**, by a property built with the `link` helper
  (`x-link: { target, label }`), for a resource that reads through its source
  (`data-access`). The codec named by the property's `x-storage` resolves the link,
  and the label is read from the codec's source.
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
links by the source's `x-link` properties.

#### Scenario: A removed target is suppressed for any group

- **WHEN** a declared link's resolved target row is soft-removed, for any target
  route group
- **THEN** a single-valued link is `null`
- **AND** a multi-valued link omits that entry from its array

#### Scenario: The persistence layer emits no href for any link

- **WHEN** the read repository or the schema-tree read produces any link object
- **THEN** it yields the label and `permid` without an `href`
- **AND** the `href` is added only at the route/envelope boundary

### Requirement: Authority reads embed their reference

A read of an `authorities` resource (single or list item) SHALL include a
`reference` field resolved from the `authorities.reference_id` foreign key. It is
declared in the authority payload source as
`link({ target: "references", label: "title" })` and resolved by the
`referencePermid` codec. The value SHALL be an object `{ title, permid, href }`:
- `title` is the referenced `refs` row's `reference->>'title'`, and the key is left
  out when that is NULL;
- `permid` is that row's `permid`;
- `href` is `/api/v1/references/{permid}`.

When the referenced reference is soft-removed, `reference` SHALL be `null`.
Authorities SHALL declare no descriptor `links`.

#### Scenario: Authority single read includes its reference

- **WHEN** an authority with a live referenced `refs` row is read by `permid`
- **THEN** `data.reference` is `{ title, permid, href }`
- **AND** `title` is the referenced row's `reference->>'title'`
- **AND** `permid` is the referenced lineage's `permid`
- **AND** `href` is `/api/v1/references/{permid}`

#### Scenario: Authority list items include their reference

- **WHEN** the authorities list is read
- **THEN** each item in `data` carries the same `reference` object shape

#### Scenario: Untitled reference

- **WHEN** an authority's referenced `refs` head has no `title`
- **THEN** `data.reference` is `{ permid, href }`, with no `title` key

#### Scenario: Removed authority reference is suppressed

- **WHEN** an authority's referenced `refs` head is soft-removed
- **THEN** `data.reference` is `null`

### Requirement: Stub reads expose the enriched shape

The stubbed `authorities`, `collections`, and `schemas` responses SHALL include
the same reference fields (`reference`, or `primaryReference` +
`additionalReferences`) when no PostgreSQL connection is configured and reads
fall back to stub data, so the response shape is identical whether or not a
database is present. The `authorities` stub SHALL be a payload in its source's
shape, carrying only fields the authority source declares.

#### Scenario: Stub authority carries a reference field

- **WHEN** authorities are read with no database configured
- **THEN** the stub `data` includes a `reference` object of the enriched shape
- **AND** it carries no field the authority source does not declare

#### Scenario: Stub collection and schema carry primary and additional references

- **WHEN** collections or schemas are read with no database configured
- **THEN** the stub `data` includes `primaryReference` and `additionalReferences`
  fields of the enriched shape
