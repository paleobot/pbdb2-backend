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

#### Scenario: The publication_type filter is unchanged

- **WHEN** references are listed with `publication_type=book`
- **THEN** the head query matches `reference->>'publicationType'` against the bound value, as before

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

### Requirement: Schema aggregate tree read

The system SHALL read a single `schemas` resource as an aggregate tree composing
the schema head with its nested characters and states. The read SHALL take the
schema head from the generic head-read repository, so the head is the same merged
record a list item is, and SHALL then read the characters and states in a single
recursive query that starts from that schema's current head by `permid` and follows
only current, non-removed versions (`succeeded_by_id IS NULL AND NOT COALESCE(removed, false)`)
at every level. The recursive query SHALL select no reference or link columns.

Each node SHALL be merged through its source: a character as
`merge(characterSource, { jsonb, columns: { permid } })` and a state as
`merge(stateSource, { jsonb, columns: { permid, quantitative } })`, with no codec
context. The read SHALL NOT copy a stored column into a node by any other route.
Neither source declares a codec; a test SHALL assert this, because a codec would
need a codec context that the tree read does not load.

The assembled tree SHALL identify every node by its `permid`. A character node
SHALL carry `characters` and `states` arrays, and a state node a `states` array,
nested by the parent columns and ordered by `sort_order` as before. Internal ids,
parent columns and `sort_order` SHALL NOT appear in any node. A schema head with no
current, non-removed version yields no tree.

#### Scenario: Schema tree assembled from current versions

- **WHEN** a schema is read by its `permid`
- **THEN** the result is the schema's merged record plus its nested characters and
  states drawn only from current, non-removed versions
- **AND** every node in the tree is identified by its `permid`

#### Scenario: A quantitative state reports it

- **WHEN** a schema with a state whose `states.quantitative` is `true` is read
- **THEN** that state node carries `quantitative: true`
- **AND** a state whose column is `false` carries `quantitative: false`

#### Scenario: The head is the list item

- **WHEN** a schema is read singly and as a list item
- **THEN** the single read without `characters` is deep-equal to the list item

#### Scenario: No storage internals in a node

- **WHEN** a schema tree is read
- **THEN** no node carries `id`, `parent_schema_id`, `parent_character_id`,
  `parent_state_id`, `sort_order` or `reference_id`

### Requirement: Responses of a resource with a payload source validate against its `out` variant
For a resource read through its payload source, every GET response's `data`, after `href` hydration, SHALL
validate against `deriveVariant(<source>, 'out')` compiled with `createAjv()`. Each list item counts as a
`data`. A unit test SHALL check this for the single, list and multi-entity (`ids`) reads and for the stub
read. An integration test against the real DDL SHALL check it for the single and list reads. Both SHALL cover
a linked resource with a label, one without, and one that is soft-removed, for a resource whose source
declares links. For references, which declare none, they SHALL cover a titled reference, an untitled one,
and two publication types. For collections and schemas they SHALL also
cover:
- for collections, one with coordinates and one without;
- child rows, one of which repeats the primary;
- no child rows;
- a removed primary;
- a removed additional reference.

A schema single read carries a `characters` tree that the schema `out` variant does
not declare. Its `data` SHALL be checked in parts: the record without `characters`
against the schema `out` variant, each character node without `characters` and
`states` against the character `out` variant, and each state node without `states`
against the state `out` variant. Whether `out` describes the tree is left to the API
design (`docs/api-design-backlog.md`). The tree SHALL include a quantitative state, a
state nested under a state, and a character nested under a character.

The `out` variant is the response contract a client may rely on (`api/docs/response-contracts.md`, §2).
A response field that `out` does not declare fails these tests.

#### Scenario: Authority single read honours its contract
- **WHEN** an authority citing a titled reference is read by `permid`
- **THEN** `data` validates against the authority `out` variant

#### Scenario: Authority list items honour the contract
- **WHEN** the authorities list is read, including one authority whose reference has no title and one whose reference is soft-removed
- **THEN** every item of `data` validates against the authority `out` variant

#### Scenario: Stub honours the contract
- **WHEN** authorities, collections, references or schemas are read with no database configured
- **THEN** the stub `data` validates against that resource's `out` variant, a schema single read in parts as above

#### Scenario: Collection reads honour their contract
- **WHEN** collections are read singly, as a list and by `ids`, covering each case listed above
- **THEN** every `data` validates against the collection `out` variant

#### Scenario: Collection removal cases
- **WHEN** a collection whose primary reference is soft-removed, and one with a soft-removed additional reference, are read
- **THEN** the first has `primaryReference: null`, the second omits that reference from `additionalReferences`, and both validate against `out`

#### Scenario: Reference reads honour their contract
- **WHEN** references are read singly, as a list and by `ids`, including an untitled reference and references of two publication types
- **THEN** every `data` validates against the reference `out` variant

#### Scenario: Schema reads honour their contract
- **WHEN** schemas are read as a list and by `ids`, covering each case listed above
- **THEN** every `data` validates against the schema `out` variant

#### Scenario: Schema tree honours its contract in parts
- **WHEN** a schema is read singly
- **THEN** its record without `characters` validates against the schema `out` variant, each character node without `characters` and `states` against the character `out` variant, and each state node without `states` against the state `out` variant
