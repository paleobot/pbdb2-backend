## MODIFIED Requirements

### Requirement: Links are declared per resource against a link-target registry

Relationship enrichment SHALL be declared in one of two ways:
- **In the resource's payload source**, by a property built with the `link` helper
  (`x-link: { target, label }`), or by an array property whose `items` are built
  with it, for a resource that reads through its source (`data-access`). The codec
  named by the property's `x-storage` resolves the link, and the label is read from
  the codec's source.
- **As data on the resource's descriptor**, for a resource with no payload source
  (`taxa`, `occurrences`): a map of output field name to a link declaration naming
  the **target route group** and the column carrying the foreign key. The column
  SHALL be on the resource's own row or on a row its repository joins one-to-one
  with it (`occurrences`: the winning identification and the identified taxon), and
  the link projection SHALL be correlated to that row. A descriptor link SHALL be
  single-valued; there is no join-table form. A multi-valued link is declared in a
  payload source, as an array whose `items` are links. The system SHALL resolve a
  target route group through a registry supplying that group's backing table, its
  label source, and the label's name.

Either way, the target's route-group name SHALL be the single identifier used to
derive the `href` base. For descriptor links it also selects the SQL source, so the
two cannot drift apart. The registry SHALL contain `references` (backing table
`refs`, label at JSONB payload key `title` in column `reference`), `authorities`
(backing table `authorities`, label at JSONB payload key `citation` in column
`authority`), `collections` (backing table `collections`, label at JSONB payload key
`name` in column `collection`), and `taxa` (backing table `taxa`, label at plain
column `name`).

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

#### Scenario: A link through a joined row

- **WHEN** an occurrence is read
- **THEN** `identification.reference` resolves from the winning identification's
  `reference_id`, and `acceptedTaxon` from the identified taxon's `concept_permid`

#### Scenario: A collection link

- **WHEN** an occurrence is read
- **THEN** `collection` carries the collection's `name`, its `permid`, and an
  `href` into the `collections` group

#### Scenario: A resource with no declared links is unenriched

- **WHEN** a resource whose descriptor declares no links is read
- **THEN** its `data` carries no enrichment fields and the read is otherwise
  unchanged

#### Scenario: A descriptor link has no join-table form

- **WHEN** the descriptor link declarations are inspected
- **THEN** none names a `joinTable` or `joinKey`, and the link projection builds
  no join-table sub-select
