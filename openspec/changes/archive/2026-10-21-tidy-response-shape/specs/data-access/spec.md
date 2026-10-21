## MODIFIED Requirements

### Requirement: Generic head-read repository
The system SHALL provide a generic read repository parameterized by a table name
and its JSONB payload column. The repository SHALL expose a single-resource read
that returns the current head of a lineage — the row matching a given `permid`
where `succeeded_by_id IS NULL` and the row is not soft-removed
(`NOT COALESCE(removed, false)`) — and a list read returning the current heads of
all non-removed lineages for the table. Returned records SHALL NEVER expose
internal serial ids or version-chain columns.

The repository SHALL be built from a descriptor that names a payload `source`.
Built without one, it SHALL throw an error naming the table, rather than read the
stored JSONB as the record. Each record SHALL be returned as
`merge(source, { jsonb, columns, children }, ctx)`:
- the head query selects `id`, `permid`, the payload, and each
  `storageSelects(source)` entry as its expression aliased to its column. A
  codec's select expression (`ST_AsGeoJSON("location")::json` for `wgs84Point`)
  is how a column reaches merge in the form it expects;
- when the descriptor declares `children: [{ table, fk }]`, one query per child
  table reads `<fk>`, `id` and the key columns that `codecKeySites(source)` lists
  for that table, for all of the read's head ids (`<fk> = ANY($1)`), ordered by
  `id`. The rows are grouped by parent and passed to merge under the table's
  name. No audit columns are read;
- `ctx` is one codec context per read, loaded by `loadCodecContext` for
  `collectCodecSources(source)`. It is restricted through `codecKeySites(source)`
  to the keys held in the read's rows and child rows. A single read and a page of
  a list therefore each cost one lookup query per codec source, plus one query
  per child table.

A resource read by this repository SHALL NOT declare descriptor `links`: its links
come from the source's `x-link` properties and items. Descriptor links remain only
for `taxa`, which has its own repository (`taxa-reads`).
Columns and child rows selected for `merge`, including `id`, SHALL NOT appear in
the record except through `merge`.

A child table's foreign key to its parent is a swing FK, so the head ids are
enough to find a head's child rows.

As of this requirement, `authorities`, `collections`, `references` and `schemas`
read through their sources. `collections` declares
`children: [{ table: "additional_collection_refs", fk: "collection_id" }]`, and
`schemas` declares `children: [{ table: "additional_schema_refs", fk: "schema_id" }]`.
`references` declares no `children`, and its source declares no codecs, so its
reads load no codec context. `specimens` has no backing table and stays stubbed.

#### Scenario: Read current head by permid

- **WHEN** the repository is asked for a `permid` that has a non-removed head
- **THEN** it returns that head row merged through the resource's source, with
  `permid` from its column

#### Scenario: Superseded and removed versions are excluded

- **WHEN** a lineage's head has `succeeded_by_id` set, or its head is
  soft-removed
- **THEN** a head read for that `permid` returns no record

#### Scenario: Missing permid yields no record

- **WHEN** the repository is asked for a `permid` with no matching lineage
- **THEN** it returns no record (the caller surfaces this as a 404)

#### Scenario: List returns only current heads

- **WHEN** the repository lists a table
- **THEN** it returns one record per non-removed lineage head
- **AND** superseded and removed rows are excluded

#### Scenario: A source-backed record is merged

- **WHEN** an authority head with `reference_id = 7` is read
- **THEN** the record is the merged payload, whose `reference` is `{ permid, title }` for ref 7
- **AND** neither `reference_id` nor any `refs.id` appears in it

#### Scenario: One lookup per page

- **WHEN** a page of 50 authorities citing 30 distinct references is read
- **THEN** one query reads the heads and one query reads exactly those 30 `refs` rows

#### Scenario: A collection is merged with its child rows and coordinates

- **WHEN** a collection head with a `location`, `reference_id = 7`, and child rows citing 7 and 12 is read
- **THEN** the record carries `location.coordinates.latitude` and `longitude`, `primaryReference` for ref 7, and `additionalReferences` for refs 7 and 12
- **AND** no `id`, `reference_id`, `location` geometry or `refs.id` appears in it

#### Scenario: A page of collections costs three queries

- **WHEN** a page of collections is read whose columns and child rows cite 40 distinct references
- **THEN** one query reads the heads, one reads their `additional_collection_refs` rows, and one reads exactly those 40 `refs` rows

#### Scenario: A collection with no location

- **WHEN** a collection head with a NULL `location` is read
- **THEN** the record has no `location.coordinates.latitude` or `longitude`

#### Scenario: A reference is merged in one query

- **WHEN** a page of references is read, or one reference by `permid`
- **THEN** one query reads the heads and no codec-context or child-row query runs
- **AND** each record is the stored payload with `permid` from its column
- **AND** no `id` or version-chain column appears in it

#### Scenario: The publicationType filter matches its payload field

- **WHEN** references are listed with the `publicationType` filter set to `book`
- **THEN** the head query matches `reference->>'publicationType'` against the bound value

#### Scenario: A schema is merged with its child rows

- **WHEN** a schema head with `reference_id = 7` and one `additional_schema_refs`
  row citing 7 is read
- **THEN** the record carries `primaryReference` for ref 7 and
  `additionalReferences` holding ref 7 once
- **AND** no `id`, `reference_id`, `references` or `refs.id` appears in it

#### Scenario: A page of schemas costs three queries

- **WHEN** a page of schemas is read
- **THEN** one query reads the heads, one reads their `additional_schema_refs`
  rows, and one reads the `refs` rows they cite

#### Scenario: A repository without a source is refused

- **WHEN** the repository is built for a table with no payload `source`
- **THEN** building it throws an error naming that table, and no query runs
