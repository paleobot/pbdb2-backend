## ADDED Requirements

### Requirement: A link target's label may be a plain column

A link target SHALL declare where its label is read from: a key within its JSONB
payload column, or a plain column on its backing table. The resolved link object
SHALL carry the same shape either way — the label under its declared name, plus
`permid`, plus the hydrated `href` — so a citing resource cannot tell which kind
of target it linked to.

This exists because not every linkable resource stores its content as JSONB. A
derived table carries typed columns and has no payload column at all; its label
is read directly from the column.

#### Scenario: A target with a payload label resolves from JSONB

- **WHEN** a link resolves against a target declaring a JSONB payload label
- **THEN** the label is read from that payload column at the declared key

#### Scenario: A target with a column label resolves from the column

- **WHEN** a link resolves against a target declaring a plain-column label
- **THEN** the label is read directly from that column
- **AND** the resulting link object carries the label, `permid` and `href`, in
  the same shape as a payload-labelled target

## MODIFIED Requirements

### Requirement: Links are declared per resource against a link-target registry

Relationship enrichment SHALL be declared as data on a resource's descriptor: a
map of output field name to a link declaration naming the **target route group**,
the column carrying the foreign key, and — for many-to-many links — the join
table and join key. The system SHALL resolve a target route group through a
registry supplying that group's backing table, its label source, and the label's
name.

The target's route-group name SHALL be the single identifier used both to select
the SQL source and to derive the `href` base, so the two cannot drift apart. The
registry SHALL contain `references` (backing table `refs`, label at JSONB payload
key `title` in column `reference`), `authorities` (backing table `authorities`,
label at JSONB payload key `citation` in column `authority`), and `taxa` (backing
table `taxa`, label at plain column `name`).

A resource that declares no links SHALL be read exactly as before, with no
enrichment applied.

#### Scenario: A declared link resolves against its target group

- **WHEN** a resource declares a link naming a target route group and a foreign
  key column, and a resource with a live target row is read
- **THEN** the named output field is an object carrying that target's label,
  its `permid`, and an `href`
- **AND** the label is read from the target group's declared label source

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
