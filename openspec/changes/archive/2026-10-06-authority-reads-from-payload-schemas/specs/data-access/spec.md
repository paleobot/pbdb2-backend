## ADDED Requirements

### Requirement: Responses of a resource with a payload source validate against its `out` variant
For a resource read through its payload source, every GET response's `data`, after `href` hydration, SHALL
validate against `deriveVariant(<source>, 'out')` compiled with `createAjv()`. Each list item counts as a
`data`. A unit test SHALL check this for the single, list and multi-entity (`ids`) reads and for the stub
read. An integration test against the real DDL SHALL check it for the single and list reads. Both SHALL cover
a linked resource with a label, one without, and one that is soft-removed.

The `out` variant is the response contract a client may rely on (`api/docs/response-contracts.md`, §2).
A response field that `out` does not declare fails these tests.

#### Scenario: Authority single read honours its contract
- **WHEN** an authority citing a titled reference is read by `permid`
- **THEN** `data` validates against the authority `out` variant

#### Scenario: Authority list items honour the contract
- **WHEN** the authorities list is read, including one authority whose reference has no title and one whose reference is soft-removed
- **THEN** every item of `data` validates against the authority `out` variant

#### Scenario: Stub honours the contract
- **WHEN** authorities are read with no database configured
- **THEN** the stub `data` validates against the authority `out` variant

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
`merge(source, { jsonb, columns }, ctx)`:
- the head query selects `permid`, the payload, and the columns
  `storageColumns(source)` names;
- `ctx` is one codec context per read, loaded by `loadCodecContext` for
  `collectCodecSources(source)`. It is restricted through `codecKeyColumns(source)`
  to the keys the read's rows hold, so a single read and a page of a list each
  cost one lookup query per codec source.

Such a resource SHALL NOT also declare descriptor `links`: its links come from the
source's `x-link` properties. The head filter, field filters, keyset pagination and
the `ids` read SHALL behave identically for both kinds of resource. Columns
selected for `merge` SHALL NOT appear in the record except through `merge`.

As of this requirement, `authorities` reads through its source. `references`,
`collections`, `specimens` and `schemas` read the JSONB payload as stored.

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
