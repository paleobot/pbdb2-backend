## MODIFIED Requirements

### Requirement: Generic head-read repository
The system SHALL provide a generic read repository parameterized by a table name
and its JSONB payload column. The repository SHALL expose a single-resource read
that returns the current head of a lineage — the row matching a given `permid`
where `succeeded_by_id IS NULL` and the row is not soft-removed
(`NOT COALESCE(removed, false)`) — and a list read returning the current heads of
all non-removed lineages for the table. Returned records SHALL expose the public
`permid` and the JSONB payload, and SHALL NEVER expose internal serial ids or
version-chain columns.

A resource whose descriptor names a payload `source` SHALL instead be returned as
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

Such a resource SHALL NOT also declare descriptor `links`: its links come from the
source's `x-link` properties and items. The head filter, field filters, keyset
pagination and the `ids` read SHALL behave identically for both kinds of resource.
Columns and child rows selected for `merge`, including `id`, SHALL NOT appear in
the record except through `merge`.

A child table's foreign key to its parent is a swing FK, so the head ids are
enough to find a head's child rows.

As of this requirement, `authorities` and `collections` read through their
sources. `collections` declares
`children: [{ table: "additional_collection_refs", fk: "collection_id" }]`.
`references`, `specimens` and `schemas` read the JSONB payload as stored.

#### Scenario: Read current head by permid

- **WHEN** the repository is asked for a `permid` that has a non-removed head
- **THEN** it returns that head row's `permid` and JSONB payload

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

### Requirement: Responses of a resource with a payload source validate against its `out` variant
For a resource read through its payload source, every GET response's `data`, after `href` hydration, SHALL
validate against `deriveVariant(<source>, 'out')` compiled with `createAjv()`. Each list item counts as a
`data`. A unit test SHALL check this for the single, list and multi-entity (`ids`) reads and for the stub
read. An integration test against the real DDL SHALL check it for the single and list reads. Both SHALL cover
a linked resource with a label, one without, and one that is soft-removed. For collections they SHALL also
cover:
- a collection with coordinates and one without;
- child rows, one of which repeats the primary;
- no child rows;
- a removed primary;
- a removed additional reference.

The `out` variant is the response contract a client may rely on (`api/docs/response-contracts.md`, §2).
A response field that `out` does not declare fails these tests.

#### Scenario: Authority single read honours its contract
- **WHEN** an authority citing a titled reference is read by `permid`
- **THEN** `data` validates against the authority `out` variant

#### Scenario: Authority list items honour the contract
- **WHEN** the authorities list is read, including one authority whose reference has no title and one whose reference is soft-removed
- **THEN** every item of `data` validates against the authority `out` variant

#### Scenario: Stub honours the contract
- **WHEN** authorities or collections are read with no database configured
- **THEN** the stub `data` validates against that resource's `out` variant

#### Scenario: Collection reads honour their contract
- **WHEN** collections are read singly, as a list and by `ids`, covering each case listed above
- **THEN** every `data` validates against the collection `out` variant

#### Scenario: Collection removal cases
- **WHEN** a collection whose primary reference is soft-removed, and one with a soft-removed additional reference, are read
- **THEN** the first has `primaryReference: null`, the second omits that reference from `additionalReferences`, and both validate against `out`
