# taxa-reads

## Purpose

Read access to `taxa`, the PBDB2 taxonomy. Unlike every other resource this API
serves, `taxa` is not hand-entered: it is materialized output of the backend's
`derive_taxa()`, carrying typed columns rather than a JSONB payload, one row per
`permid` with no version chain, and no write path at all — taxonomy is written
through the *opinion* tables. It is therefore the API's first read-only resource,
and the first whose representation includes a hierarchy: each taxon carries the
chain of taxa containing it, which reaches depth 70 in real data and so is
treated differently on a single read than in a list.

This capability covers the taxa representation, its read-only verb surface,
dictionary flattening, the containing-taxa chain and its per-endpoint rules, and
the `includeContainingTaxa` opt-in. The measurements behind these decisions are
in `docs/taxa-classification-reads.md`; the decisions themselves are in
`openspec/changes/archive/*-add-taxa-reads/design.md`.

## Requirements

### Requirement: Taxa resource representation

The system SHALL expose a `taxa` route group whose read representation carries
the taxon's `permid` and `name`, its `rank` and `nomenclaturalStatus` as text
values flattened from their dictionaries, its `authority` and `accepted` as
resolved link objects, and — per the containing-taxa rules below — its
`containingTaxa` chain. Field names SHALL be camelCase, matching every other
resource representation.

`nomenclaturalStatus` SHALL be null when the taxon has no nomenclatural status
recorded, which is the representation of a nomenclaturally valid name.
`authority` SHALL be null when the taxon has no authority recorded.

The representation SHALL NOT expose internal serial ids, the winning-opinion
foreign keys, `original_permid`, or `accepted_spelling_permid`.

#### Scenario: Single taxon read

- **WHEN** a client sends GET to the `taxa` path with a `permid` that exists
- **THEN** the system responds with HTTP 200 in the standard envelope
- **AND** `meta.type` is `taxon`
- **AND** `data` carries `permid`, `name`, `rank`, `nomenclaturalStatus`,
  `authority`, `accepted` and `containingTaxa`

#### Scenario: Taxon not found

- **WHEN** a client sends GET to the `taxa` path with a `permid` that has no row
- **THEN** the system responds with HTTP 404 in the standard error shape

#### Scenario: Internal columns are never exposed

- **WHEN** any taxon is returned, singly or in a list
- **THEN** its representation carries no internal serial id, no
  `winning_*_opinion_id`, no `original_permid` and no `accepted_spelling_permid`

### Requirement: Dictionary values are flattened to text

`rank` and `nomenclaturalStatus` SHALL be rendered as the text value of the
dictionary entry the taxon's foreign key names, not as link objects. Dictionary
entries are not resources: they carry no `permid` and have no read URL.

#### Scenario: Rank renders as text

- **WHEN** a taxon whose rank is the dictionary entry `genus` is read
- **THEN** `rank` is the string `genus`

#### Scenario: Absent nomenclatural status renders as null

- **WHEN** a taxon with no nomenclatural status recorded is read
- **THEN** `nomenclaturalStatus` is null

### Requirement: Taxa reads are read-only

The `taxa` route group SHALL expose GET only. `taxa` is materialized output of
the backend's derivation routine, and the write surface for taxonomy is the
opinion tables, which are separate resources.

Requests to a `taxa` path using POST, PUT, PATCH or DELETE SHALL be answered with
HTTP 405 and an `Allow` header naming the permitted methods. They SHALL NOT be
answered with 404, and SHALL NOT return a stubbed success.

#### Scenario: Write verb is rejected

- **WHEN** a client sends POST, PUT, PATCH or DELETE to a `taxa` list or item
  path
- **THEN** the system responds with HTTP 405 in the standard error shape
- **AND** the response carries an `Allow` header naming the permitted methods
- **AND** no database write is attempted

### Requirement: Taxa are not version-chained

A taxon SHALL be read as the single row bearing its `permid`, with no version
resolution and no soft-removal predicate. The backing table holds exactly one row
per `permid`, is rebuilt in place, and hard-deletes rows that its derivation no
longer produces. Soft deletion is honored upstream, at the opinion tables the
derivation reads.

The `taxa` group SHALL NOT expose a `/versions` sub-resource.

#### Scenario: A taxon reads without version resolution

- **WHEN** a taxon is read by `permid`
- **THEN** the row bearing that `permid` is returned
- **AND** the read applies no version-chain or soft-removal predicate

### Requirement: The containing-taxa chain

A taxon's `containingTaxa` SHALL be the chain of its ancestors, ordered from its
immediate container root-ward, each carrying `rank`, `name`, `permid` and `href`,
and each nesting the next under its own `containingTaxa`. A root taxon's
`containingTaxa` SHALL be null.

The chain SHALL be derived from the taxon's stored classification path, decoded
behind a single isolating function so the backend may reshape or drop that column
as a cache change without the decision reaching the rest of the system. The chain
SHALL NOT be depth-capped.

The chain SHALL contain the taxon's ancestors only, never the taxon itself: the
final element of the stored path names the taxon's own concept, which for a taxon
that is not its own concept is a different resource.

#### Scenario: A deep taxon carries its full chain

- **WHEN** a taxon at depth N is read singly
- **THEN** `containingTaxa` nests N-1 ancestors, ordered root-ward from its
  immediate container
- **AND** each carries `rank`, `name`, `permid` and `href`

#### Scenario: A root taxon has no chain

- **WHEN** a taxon with no containing concept is read
- **THEN** `containingTaxa` is null

#### Scenario: The taxon itself is not in its own chain

- **WHEN** a taxon whose concept differs from its own `permid` is read
- **THEN** `containingTaxa` does not contain that taxon

### Requirement: The chain is always present on single reads and opt-in on lists

A single taxon read SHALL always carry its `containingTaxa` chain, with no
parameter required and none available to suppress it.

A taxa list read SHALL omit `containingTaxa` from its items unless the request
carries `includeContainingTaxa=true`. The parameter SHALL accept exactly `true`
or `false`; any other value, including the parameter present with no value, SHALL
be rejected with HTTP 400.

The parameter SHALL be accepted on a multi-entity `ids` read, which is a list and
carries list semantics.

#### Scenario: List omits the chain by default

- **WHEN** a client sends GET to the `taxa` list endpoint with no
  `includeContainingTaxa` parameter
- **THEN** no list item carries a `containingTaxa` field

#### Scenario: List includes the chain on request

- **WHEN** a client sends GET to the `taxa` list endpoint with
  `includeContainingTaxa=true`
- **THEN** every list item carries its `containingTaxa` chain

#### Scenario: The opt-in is accepted alongside ids

- **WHEN** a client sends GET to the `taxa` list endpoint with both `ids` and
  `includeContainingTaxa=true`
- **THEN** the system responds with HTTP 200
- **AND** each returned taxon carries its `containingTaxa` chain

#### Scenario: A non-boolean opt-in value is rejected

- **WHEN** a client sends `includeContainingTaxa` with a value other than `true`
  or `false`, or with no value
- **THEN** the system responds with HTTP 400 in the standard error shape

#### Scenario: The single read ignores no parameter to suppress the chain

- **WHEN** a client reads a single taxon
- **THEN** `containingTaxa` is present regardless of any `includeContainingTaxa`
  value the request carries

### Requirement: Taxa lists are paginated in `permid` order

The `taxa` list endpoint SHALL accept `limit` and `cursor` and return a bounded
page with pagination links, on the same terms as every other list endpoint, using
the stable `permid` ordering the pagination capability defines. The `taxa` list
SHALL NOT be unbounded.

#### Scenario: Taxa list is bounded and paginated

- **WHEN** a client sends GET to the `taxa` list endpoint with no parameters
- **THEN** `data` contains at most the default page size
- **AND** `links.next` is a URL when further taxa exist

### Requirement: Taxa declare no field filters

The `taxa` list endpoint SHALL declare no field filters in this change. A query
parameter naming a taxon attribute SHALL therefore be an unrecognized parameter
and be rejected accordingly.

#### Scenario: A taxon attribute is not a filter

- **WHEN** a client sends GET to the `taxa` list endpoint with a parameter naming
  a taxon attribute such as rank
- **THEN** the system responds with HTTP 400 for an unrecognized parameter
