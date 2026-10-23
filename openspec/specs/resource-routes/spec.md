# resource-routes

## Purpose

The six PBDB2 resource route groups — references, authorities, collections,
specimens, schemas, and taxa — exposed under the versioned base path and
addressed by `permid`. Four are uniform CRUD; `schemas` returns an aggregate tree
on read; `taxa` is read-only, answering 405 on every write verb because it is
derived output rather than hand-entered data.

This capability also governs what a request may carry: the multi-entity `ids`
read, per-entity field filters, the pagination parameters, and the rule that an
unrecognized query parameter is rejected rather than ignored.
## Requirements
### Requirement: Resource route groups

The system SHALL provide route groups for `references`, `authorities`,
`collections`, `specimens`, `schemas`, and `taxa` under the versioned API base
path. Each route group SHALL be addressable by `permid`.

Five groups expose full CRUD verb coverage; `taxa` is read-only. `schemas`
returns an aggregate tree on single read; `taxa` returns a representation
carrying its containing-taxa chain.

#### Scenario: Each resource group is mounted

- **WHEN** a client requests the list endpoint of any of the six resources
- **THEN** the system responds with HTTP 200 in the standard envelope

#### Scenario: Taxa is mounted as a read-only group

- **WHEN** a client requests the `taxa` list endpoint
- **THEN** the system responds with HTTP 200 in the standard envelope
- **AND** the group exposes no write verbs

#### Scenario: Each group is addressable by permid

- **WHEN** a client requests a resource path with a `permid`
- **THEN** the addressed resource is identified by that `permid`

### Requirement: CRUD verb coverage

The system SHALL expose create, read (single and list), update, and delete on
each uniform resource group (`references`, `authorities`, `collections`,
`specimens`) across the corresponding HTTP verbs (POST, GET, PUT/PATCH, DELETE).

The read verbs (GET list and GET single) for `references`, `authorities`, and
`collections` SHALL return data persisted in PostgreSQL, read as the current head
of each lineage via the generic read repository. A single read for a `permid`
with no current, non-removed head SHALL respond with HTTP 404. The `specimens`
read SHALL remain stubbed until a backing table exists (none is present in the
backend schema). The write verbs (POST, PUT, PATCH, DELETE) on all uniform groups
MAY continue to return stubbed responses and SHALL NOT access a database in this
change.

#### Scenario: List read

- **WHEN** a client sends GET to a DB-backed resource collection endpoint
  (`references`, `authorities`, `collections`)
- **THEN** the system responds with HTTP 200
- **AND** `data` is an array of current lineage heads from PostgreSQL

#### Scenario: Single read found

- **WHEN** a client sends GET to a DB-backed resource path with a `permid` that
  has a current, non-removed head
- **THEN** the system responds with HTTP 200
- **AND** `data` is the requested resource object identified by its `permid`

#### Scenario: Single read not found

- **WHEN** a client sends GET to a DB-backed resource path with a `permid` that
  has no current, non-removed head
- **THEN** the system responds with HTTP 404 in the standard error shape

#### Scenario: Specimens read remains stubbed

- **WHEN** a client sends GET to the `specimens` list or a `specimens` `permid`
- **THEN** the system responds with HTTP 200 from stubbed data, with no database
  access

#### Scenario: Create

- **WHEN** an authorized client sends POST to a resource collection endpoint
- **THEN** the system responds with a success status
- **AND** the created resource is returned in the standard envelope

#### Scenario: Update

- **WHEN** an authorized client sends PUT or PATCH to a resource path
- **THEN** the system responds with a success status
- **AND** the updated resource is returned in the standard envelope

#### Scenario: Delete

- **WHEN** an authorized client sends DELETE to a resource path
- **THEN** the system responds with a success status

### Requirement: Read-only resource groups

The system SHALL support read-only route groups as a first-class shape of the
shared route factory, not as hand-written exceptions. A read-only group exposes
the read verbs (GET list and GET single) and SHALL answer every write verb (POST,
PUT, PATCH, DELETE) with HTTP 405 and an `Allow` header naming the permitted
methods.

A read-only group SHALL NOT attach the authentication preHandler to its write
verbs: there is no write to authorize, and the method is refused regardless of
the caller's identity.

`taxa` is the first such group. Read-only status is a property of the resource,
declared where its routes are registered, so that a further derived-table
resource requires no new factory work.

#### Scenario: Read verbs are served

- **WHEN** a client sends GET to a read-only group's list or item path
- **THEN** the system responds with HTTP 200 in the standard envelope

#### Scenario: Write verbs are refused with 405

- **WHEN** a client sends POST, PUT, PATCH or DELETE to a read-only group's list
  or item path
- **THEN** the system responds with HTTP 405 in the standard error shape
- **AND** the response carries an `Allow` header naming the permitted methods

#### Scenario: A refused write verb is not an authentication failure

- **WHEN** an unauthenticated client sends a write verb to a read-only group
- **THEN** the system responds with HTTP 405, not an authentication error

### Requirement: Schemas aggregate read representation

The `schemas` resource SHALL return its read representation as an aggregate that
composes the schema together with its nested characters and states, rather than
as a flat single-record payload. On read, the aggregate SHALL be assembled from
data persisted in PostgreSQL, following only current, non-removed versions at the
schema, character, and state levels. A read for a `permid` with no current,
non-removed schema head SHALL respond with HTTP 404. Write handling for the
nested characters and states remains out of scope.

The schema part of the aggregate SHALL be the same record the `schemas` list
returns for that schema, and every character and state in it SHALL carry the
fields its payload source declares, including a state's `quantitative`
(`data-access`, "Schema aggregate tree read").

#### Scenario: Reading a schema returns its tree

- **WHEN** a client requests a single schema by its `permid` that has a current,
  non-removed head
- **THEN** `data` contains the schema together with its nested characters and
  states, drawn from PostgreSQL

#### Scenario: Reading a missing schema

- **WHEN** a client requests a schema `permid` with no current, non-removed head
- **THEN** the system responds with HTTP 404 in the standard error shape

#### Scenario: A schema's states report quantitative

- **WHEN** a client reads a schema whose tree holds a state with
  `states.quantitative = true`
- **THEN** that state in `data` carries `quantitative: true`

### Requirement: Multi-entity read via `ids` list filter

The system SHALL accept an optional comma-separated `ids` query parameter on the
list endpoint of every uniform resource group (`references`, `authorities`,
`collections`, `specimens`), returning the matching current lineage heads. The multi-entity read SHALL be served by the existing list
endpoint and route — it SHALL NOT introduce a new path. When `ids` is present,
the system SHALL return only the requested resources; when `ids` is absent, the
list endpoint SHALL continue to return all current heads unchanged.

The response SHALL use the standard list envelope (`data` is an array) for every
multi-entity read, including a request for a single id. The singular
`data`-as-object shape SHALL remain reserved for the `GET /{permid}` path.

Requested ids SHALL be treated as a set: duplicates collapse and result order is
not guaranteed. `permid`s are opaque identifiers; the system SHALL NOT perform
per-id syntactic validation — an id that matches no current, non-removed head is
reported as missing rather than rejected.

#### Scenario: Multi-entity read returns the requested subset

- **WHEN** a client sends GET to a DB-backed resource list endpoint with
  `?ids=` naming several `permid`s that have current, non-removed heads
- **THEN** the system responds with HTTP 200
- **AND** `data` is an array containing exactly those resources

#### Scenario: Single id still returns a list

- **WHEN** a client sends GET to a resource list endpoint with `?ids=` naming a
  single `permid`
- **THEN** the system responds with HTTP 200
- **AND** `data` is an array containing the one resource

#### Scenario: Absent `ids` lists everything

- **WHEN** a client sends GET to a resource list endpoint with no `ids`
  parameter
- **THEN** the system returns all current lineage heads, as before

#### Scenario: Duplicate ids collapse

- **WHEN** a client sends `?ids=` naming the same `permid` more than once
- **THEN** that resource appears at most once in `data`

### Requirement: Multi-entity partial-success contract

A multi-entity read SHALL succeed with HTTP 200 and return the subset of
requested resources that exist, even when some requested ids have no current,
non-removed head. Missing ids SHALL NOT cause the request to fail.

The response `meta` SHALL report `requested` (the count of distinct requested
ids), `returned`, and `missing`. The `missing` field SHALL always be present as
an array of the requested ids that were not found, and SHALL be an empty array
when every requested id was found. `meta` SHALL NOT report `found`, which would
always equal `returned` (`list-pagination`).

#### Scenario: Some requested ids are missing

- **WHEN** a client requests several ids where some have current heads and some
  do not
- **THEN** the system responds with HTTP 200
- **AND** `data` contains only the found resources
- **AND** `meta.missing` lists the requested ids that were not found
- **AND** `meta.returned` equals `meta.requested` minus the number of missing ids

#### Scenario: All requested ids found

- **WHEN** a client requests ids that all have current heads
- **THEN** the system responds with HTTP 200
- **AND** `meta.missing` is an empty array

### Requirement: Empty `ids` parameter is rejected

The system SHALL distinguish an absent `ids` parameter from one that is present
but carries no value. An `ids` parameter that is present with an empty value (or
resolves to no ids after splitting) SHALL be rejected with HTTP 400. An absent
`ids` parameter SHALL NOT be rejected and SHALL list all current heads.

#### Scenario: Empty ids value is a 400

- **WHEN** a client sends a request with `?ids=` and no value
- **THEN** the system responds with HTTP 400 in the standard error shape

#### Scenario: Absent ids is not an error

- **WHEN** a client sends a request with no `ids` parameter at all
- **THEN** the system responds with HTTP 200 and lists all current heads

### Requirement: Multi-entity read batch cap

A single multi-entity read SHALL accept at most 100 distinct ids. A request
naming more than 100 ids SHALL be rejected with HTTP 400. A body-based batch
endpoint for larger sets is out of scope for this change.

#### Scenario: Over-cap request is rejected

- **WHEN** a client sends `?ids=` naming more than 100 ids
- **THEN** the system responds with HTTP 400 in the standard error shape

#### Scenario: At-cap request is accepted

- **WHEN** a client sends `?ids=` naming 100 or fewer ids
- **THEN** the system processes the multi-entity read normally

### Requirement: Multi-entity read stub fallback

A multi-entity read SHALL echo each requested id back as a stub record on any
stub-backed resource group — `specimens`, or any build with no database
configured. The response SHALL use the same list envelope and partial-success
`meta` shape as the DB-backed path, with `meta.missing` empty (every echoed id
is "found").

#### Scenario: Stub resource echoes requested ids

- **WHEN** a client sends GET to a stub-backed resource list endpoint with
  `?ids=` naming several ids
- **THEN** the system responds with HTTP 200
- **AND** `data` is an array of stub records, one per requested id
- **AND** `meta.missing` is an empty array

### Requirement: Per-entity field filters

The system SHALL support per-entity field filters on the list endpoint, declared
per resource and matching a query-parameter value against a field within that
resource's JSONB payload. A field filter's query parameter SHALL be the name of
the payload field it matches, or, for a filter that matches only part of a field,
a camelCase name for that part (`firstAuthor` matches the first element of
`authors`), so that parameters, expansions and response fields share one camelCase
vocabulary. The `references` group SHALL support a
`publicationType` filter matching the payload's `publicationType` field. Field
filters SHALL compose with the multi-entity `ids` read and with one another,
narrowing the same set of current, non-removed heads (logical AND).

When the field a filter matches is a property of the resource's payload source
that declares an `enum`, the filter's legal values SHALL be exactly that enum, and
a value outside it SHALL be rejected with HTTP 400 in the standard error shape.
The error message SHALL name the parameter and list the legal values in enum
order. The comparison is exact, after trimming surrounding whitespace. The
`references` `publicationType` filter takes its legal values from the reference
source's `publicationType` enum. A filter whose field has no such enum accepts any
non-empty value.

A legal field-filter value that matches no current head SHALL yield an empty
result with HTTP 200 — field filters are pure filters and SHALL NOT produce the
`meta.missing` accounting reserved for the `ids` set semantics. A field-filter
parameter that is present with an empty value SHALL be rejected with HTTP 400.

When a field filter is combined with the `ids` read, the request SHALL be
treated as a filtered query: the `ids` partial-success accounting
(`meta.requested` / `meta.missing`) SHALL be suppressed. That accounting answers
"which requested ids have no current head?", which is only well-defined when the
id set is the sole constraint — a field filter introduces a second reason an id
can be absent from the result (filtered out rather than non-existent), so the
signal is withheld rather than overloaded.

#### Scenario: References filtered by publication type

- **WHEN** a client sends GET to the `references` list endpoint with
  `?publicationType=` naming a value
- **THEN** the system responds with HTTP 200
- **AND** `data` contains only the current heads whose `publicationType` equals
  that value

#### Scenario: The former snake_case name is unrecognized

- **WHEN** a client sends GET to `references` with `?publication_type=` naming a
  legal value
- **THEN** the system responds with HTTP 400 in the standard error shape
- **AND** the message names `publication_type` as unrecognized and lists
  `publicationType` among the accepted parameters

#### Scenario: Field filter composes with ids

- **WHEN** a client sends GET to `references` with both `?ids=` and
  `?publicationType=`
- **THEN** `data` contains only the requested ids that also match the
  publication type
- **AND** the `ids` partial-success accounting (`meta.requested` /
  `meta.missing`) is suppressed

#### Scenario: Field filter with no match

- **WHEN** a client sends `?publicationType=` with a legal value no current head has
- **THEN** the system responds with HTTP 200 and an empty `data` array
- **AND** no `meta.missing` accounting is produced

#### Scenario: Empty field-filter value is a 400

- **WHEN** a client sends `?publicationType=` with no value
- **THEN** the system responds with HTTP 400 in the standard error shape

#### Scenario: Field-filter value outside the enum is a 400

- **WHEN** a client sends `?publicationType=book`, which is not one of the
  reference source's publication types
- **THEN** the system responds with HTTP 400 in the standard error shape
- **AND** the message names `publicationType` and lists the legal values,
  including `standalone book`

#### Scenario: Enum check applies to the ids read

- **WHEN** a client sends `?ids=` together with a `publicationType` value outside
  the enum
- **THEN** the system responds with HTTP 400, as it would on a plain list

#### Scenario: Legal values come from the source

- **WHEN** the `references` repository is built
- **THEN** its `publicationType` filter's legal values equal
  `referenceSource.properties.publicationType.enum`, in order

### Requirement: Reference filters on shared fields

The `references` list endpoint SHALL support the field filters `doi`, `title`,
`authors`, `firstAuthor` and `publicationYear`, which match fields every publication
type carries. They follow the per-entity field-filter rules: they compose with each
other, with `publicationType` and with `ids` (logical AND); an empty value is a 400;
a legal value that matches nothing is an empty 200. Every comparison is made after
trimming the value's surrounding whitespace.

- `doi` SHALL match a reference whose stored `doi`, with a leading
  `https://doi.org/`, `http://doi.org/`, `https://dx.doi.org/`, `http://dx.doi.org/`
  or `doi:` removed, equals the parameter value with the same prefix removed,
  ignoring case. A value that is empty once the prefix is removed SHALL be a 400.
- `title` SHALL match a reference whose `title` contains every whitespace-separated
  word of the value as a substring, in any order, ignoring case and accents. The
  characters `%`, `_` and `\` in the value SHALL be matched literally. A reference
  with no `title` SHALL NOT match.
- `authors` SHALL take a comma-separated list of family names and match a reference
  that has, for each name, at least one author whose `familyName` equals it, ignoring
  case and accents. An empty item in the list SHALL be a 400.
- `firstAuthor` SHALL take one family name and match a reference whose first author's
  `familyName` equals it, ignoring case and accents. A value containing a comma SHALL
  be a 400.
- `publicationYear` SHALL take a four-digit year (`YYYY`) or a range of two
  (`YYYY-YYYY`), and match a reference whose stored `publicationYear` is four digits
  and lies in that year or range, both ends included. A range whose first year is
  later than its second SHALL be a 400 that names the parameter; any other form
  SHALL be a 400 that names the parameter and the accepted forms. A stored
  `publicationYear` that is not four digits SHALL NOT match.

`enteredBy` is not a filter; a request naming it is an unrecognized parameter.

#### Scenario: A DOI matches across prefix and case

- **GIVEN** a current reference whose stored `doi` is `https://doi.org/10.1234/ABC`
- **WHEN** a client sends GET to `references` with `?doi=10.1234/abc`
- **THEN** the system responds with HTTP 200 and `data` includes that reference
- **AND** the same reference is returned for `?doi=doi:10.1234/ABC`

#### Scenario: A DOI is not unique

- **GIVEN** two current references with the same `doi`
- **WHEN** a client sends `?doi=` naming it
- **THEN** `data` contains both

#### Scenario: Title words match in any order

- **GIVEN** a current reference titled `Archosaurs of the Late Triassic`
- **WHEN** a client sends `?title=triassic archosaur`
- **THEN** `data` includes that reference
- **AND** `?title=triassic mammal` does not return it

#### Scenario: Title matching ignores accents and treats wildcards literally

- **GIVEN** a current reference titled `Faunes du Pliocène`
- **WHEN** a client sends `?title=pliocene`
- **THEN** `data` includes that reference
- **AND** `?title=%` returns only references whose title contains a `%`

#### Scenario: Every named author must be present

- **GIVEN** a current reference whose authors have the family names `Sues` and
  `Reisz`, and another whose only author is `Sues`
- **WHEN** a client sends `?authors=sues,Reisz`
- **THEN** `data` includes the first reference and not the second

#### Scenario: Author matching ignores accents and case

- **GIVEN** a current reference with an author whose `familyName` is `Schröder`
- **WHEN** a client sends `?authors=schroder`
- **THEN** `data` includes that reference

#### Scenario: Author matching is on the whole family name

- **GIVEN** a current reference whose only author's `familyName` is `de la Fuente`
- **WHEN** a client sends `?authors=Fuente`
- **THEN** `data` does not include that reference

#### Scenario: An empty author item is a 400

- **WHEN** a client sends `?authors=Sues,`
- **THEN** the system responds with HTTP 400 in the standard error shape naming
  `authors`

#### Scenario: firstAuthor matches only the first author

- **GIVEN** a current reference whose authors are, in order, `Reisz` then `Sues`
- **WHEN** a client sends `?firstAuthor=Sues`
- **THEN** `data` does not include that reference
- **AND** `?firstAuthor=Reisz` includes it

#### Scenario: firstAuthor takes one name

- **WHEN** a client sends `?firstAuthor=Sues,Reisz`
- **THEN** the system responds with HTTP 400 in the standard error shape naming
  `firstAuthor`

#### Scenario: A single year matches that year

- **WHEN** a client sends `?publicationYear=1990`
- **THEN** `data` contains only current references whose `publicationYear` is `1990`

#### Scenario: A year range includes both ends

- **GIVEN** current references published in `1989`, `1990`, `2000` and `2001`
- **WHEN** a client sends `?publicationYear=1990-2000`
- **THEN** `data` includes the `1990` and `2000` references and not the `1989` or
  `2001` ones

#### Scenario: A reversed year range is a 400

- **WHEN** a client sends `?publicationYear=2000-1990`
- **THEN** the system responds with HTTP 400 in the standard error shape naming
  `publicationYear`

#### Scenario: A malformed year is a 400

- **WHEN** a client sends `?publicationYear=79`, `?publicationYear=1990-` or
  `?publicationYear=1990..2000`
- **THEN** the system responds with HTTP 400 in the standard error shape naming
  `publicationYear` and the forms `YYYY` and `YYYY-YYYY`

#### Scenario: A stored year that is not four digits never matches

- **GIVEN** a current reference whose stored `publicationYear` is `79`
- **WHEN** a client sends `?publicationYear=0001-9999`
- **THEN** `data` does not include that reference

#### Scenario: Shared-field filters compose

- **WHEN** a client sends `?firstAuthor=Sues&publicationYear=1990-2000&title=dinosaur`
- **THEN** `data` contains only current references matching all three

#### Scenario: enteredBy is not a filter

- **WHEN** a client sends `?enteredBy=Smith`
- **THEN** the system responds with HTTP 400 naming `enteredBy` as unrecognized

### Requirement: Reference filters on type-specific fields

The `references` list endpoint SHALL support the field filters `journalTitle`,
`seriesTitle`, `bookTitle`, `publisher`, `publicationCity` and `bookType`, which match
fields that only some publication types allow. They follow the per-entity field-filter
rules: they compose with each other, with the shared-field filters, with
`publicationType` and with `ids` (logical AND); an empty value is a 400; a value that
matches nothing is an empty 200. Every comparison is made after trimming the value's
surrounding whitespace.

A filter SHALL match its field wherever the field is stored, whatever the reference's
`publicationType`. It SHALL NOT add a `publicationType` condition, and it SHALL NOT
require a `publicationType` parameter. A request whose filters contradict each other
(a `bookType` with `publicationType=journal article`) SHALL be an empty 200, not a 400.

- `journalTitle` and `seriesTitle` SHALL match a reference whose whole stored value
  equals the parameter value, ignoring case and accents, after each run of whitespace on
  both sides is collapsed to one space. A stored value that contains the parameter value
  as part of a longer title SHALL NOT match.
- `bookTitle`, `publisher` and `publicationCity` SHALL match a reference whose stored
  value contains every whitespace-separated word of the parameter value as a substring,
  in any order, ignoring case and accents, with `%`, `_` and `\` matched literally, as
  `title` does.
- `bookType` SHALL match a reference whose stored `bookType` equals the parameter value
  exactly. Its value is opaque: a value outside the `book_types` dictionary SHALL be an
  empty 200, not a 400, because the field has no inline `enum`.

A reference with no value for a filter's field SHALL NOT match that filter.

#### Scenario: A journal title matches the whole title only

- **GIVEN** current references in the journals `Palaeontology` and
  `Journal of Systematic Palaeontology`
- **WHEN** a client sends GET to `references` with `?journalTitle=palaeontology`
- **THEN** the system responds with HTTP 200
- **AND** `data` includes the `Palaeontology` reference and not the other one

#### Scenario: A journal title ignores accents and whitespace runs

- **GIVEN** a current reference whose stored `journalTitle` is
  `Revue de  Paléobiologie`, with two spaces after `de`
- **WHEN** a client sends `?journalTitle=revue de paleobiologie`
- **THEN** `data` includes that reference

#### Scenario: A series title matches the whole title

- **GIVEN** a current reference whose stored `seriesTitle` is
  `American Museum Novitates`
- **WHEN** a client sends `?seriesTitle=american museum novitates`
- **THEN** `data` includes that reference
- **AND** `?seriesTitle=Novitates` does not return it

#### Scenario: Publisher words match variants

- **GIVEN** current references whose publishers are `Elsevier` and `Elsevier BV`
- **WHEN** a client sends `?publisher=elsevier`
- **THEN** `data` includes both

#### Scenario: Publication city words match in any order

- **GIVEN** a current reference whose `publicationCity` is `Washington, D.C.`
- **WHEN** a client sends `?publicationCity=washington`
- **THEN** `data` includes that reference

#### Scenario: A book title matches the containing book

- **GIVEN** a current `article in edited collection` whose `bookTitle` is
  `The Dinosauria`, and a current `edited collection` whose `title` is
  `The Dinosauria` and which has no `bookTitle`
- **WHEN** a client sends `?bookTitle=dinosauria`
- **THEN** `data` includes the article and not the edited collection

#### Scenario: bookType matches exactly

- **GIVEN** a current reference whose `bookType` is `Ph.D. thesis`
- **WHEN** a client sends `?bookType=Ph.D. thesis`
- **THEN** `data` includes that reference

#### Scenario: An unknown bookType is an empty 200

- **WHEN** a client sends `?bookType=novel`
- **THEN** the system responds with HTTP 200 and an empty `data` array

#### Scenario: A field on a type that does not allow it still matches

- **GIVEN** a current `journal article` whose stored `publisher` is `Elsevier BV`
- **WHEN** a client sends `?publisher=Elsevier`
- **THEN** `data` includes that reference

#### Scenario: Contradictory filters are an empty 200

- **WHEN** a client sends `?publicationType=journal article&bookType=monograph`
- **THEN** the system responds with HTTP 200 and an empty `data` array, unless a
  stored journal article carries that `bookType`

#### Scenario: Type-specific filters compose with shared ones

- **WHEN** a client sends `?journalTitle=Palaeontology&publicationYear=2010-2020`
- **THEN** `data` contains only current references matching both

### Requirement: List endpoints accept pagination parameters

Every list endpoint — on the uniform resource groups and on `schemas` — SHALL
accept the `limit` and `cursor` pagination parameters and return a bounded page
with pagination links, per the `list-pagination` capability. A list endpoint
SHALL NOT return an unbounded result set.

#### Scenario: Every list endpoint is bounded

- **WHEN** a client sends GET to any resource list endpoint with no parameters
- **THEN** the system responds with HTTP 200
- **AND** `data` contains at most the default page size

### Requirement: The `schemas` list uses the shared list-filter seam

The `schemas` list endpoint SHALL parse its query parameters through the same
shared list-filter seam as the uniform resource groups, rather than reading heads
directly. It SHALL thereby accept the multi-entity `ids` read and the pagination
parameters on the same terms as every other list endpoint. The `schemas` single
read SHALL remain the aggregate tree, which is not paginated.

#### Scenario: Schemas list accepts ids

- **WHEN** a client sends GET to the `schemas` list endpoint with `?ids=` naming
  several `permid`s
- **THEN** the system responds with HTTP 200
- **AND** `data` contains exactly the requested schema heads

#### Scenario: Schemas list is paginated

- **WHEN** a client sends GET to the `schemas` list endpoint with `?limit=`
- **THEN** `data` contains at most that many schema heads
- **AND** `links.next` is a URL when further schemas exist

#### Scenario: The schema tree is not paginated

- **WHEN** a client requests a single schema by `permid`
- **THEN** the aggregate tree is returned whole, with its nested characters and
  states unpaginated

### Requirement: Strict query-param handling

The system SHALL reject a request carrying an unrecognized query parameter with
HTTP 400, naming the unrecognized parameter or parameters. This SHALL apply to
single reads as well as list reads, so that parameter handling does not differ by
endpoint shape.

A parameter is recognized when it is one of the universal list parameters
(`ids`, `limit`, `cursor`), a field filter the resource declares, or an
expansion parameter the resource declares. A resource that declares no filters
and no expansions therefore recognizes only the universal list parameters on its
list endpoint, and none on its single read.

Each read route SHALL declare the parameters it recognizes as a querystring
schema, and the system SHALL validate requests against that schema, so that the
parameters the API description lists are the parameters the route enforces
(`api-description`). Before validation, every query value SHALL be trimmed of
surrounding whitespace, and a parameter declared as an integer SHALL be a bare
string of digits (so `1e3`, `0x10` and `1.0` are rejected, not converted). Each
parameter SHALL carry one value: a repeated parameter SHALL be rejected with HTTP
400. A validation failure SHALL be reported in the standard error shape with the
same message the parameter's rule gives on a hand-checked request, so declaring
the schema changes no response.

This replaces the previous provisional leniency, under which an unrecognized
parameter was ignored. The reason is that a silently ignored parameter yields a
response indistinguishable from a correct one — a misspelled filter returns an
unfiltered list that reads as "everything matched", and a misspelled expansion
returns an unexpanded record that reads as "there was nothing to expand".

The same reasoning applies to field-filter *values*. A value outside the legal
values that the resource's payload source declares for that field SHALL be
rejected with HTTP 400 (see "Per-entity field filters"), because an empty result
for a value that cannot exist reads as "nothing matched". Where the source
declares no enum for the field, values remain opaque: a well-formed value that
matches no stored value SHALL yield an empty result rather than an error.

#### Scenario: Unknown query parameter is rejected

- **WHEN** a client sends a query parameter the resource does not recognize
- **THEN** the system responds with HTTP 400 in the standard error shape
- **AND** the error names the unrecognized parameter

#### Scenario: Unknown parameter is rejected on a single read

- **WHEN** a client sends an unrecognized query parameter to a single-resource
  read
- **THEN** the system responds with HTTP 400, as it would on a list read

#### Scenario: Declared parameters are accepted

- **WHEN** a client sends a field filter or expansion parameter the resource
  declares
- **THEN** the request is not rejected for that parameter

#### Scenario: A legal filter value matching nothing is not an error

- **WHEN** a client sends a declared field-filter value that is legal for its
  field but matches no stored value
- **THEN** the system responds with HTTP 200 and an empty `data` array, not an
  error

#### Scenario: The declared schema is what is enforced

- **WHEN** the querystring schema a list route declares is compared with the
  parameters the route accepts
- **THEN** every declared parameter is accepted and any other is a 400 naming it

#### Scenario: Surrounding whitespace is trimmed

- **WHEN** a client sends `?publicationType=%20standalone%20book%20`
- **THEN** the filter matches `standalone book`, as without the spaces

#### Scenario: A non-decimal limit is rejected

- **WHEN** a client sends `?limit=1e3`, `?limit=0x10` or `?limit=1.0`
- **THEN** the system responds with HTTP 400 saying `limit` must be a positive integer

#### Scenario: A repeated parameter is rejected

- **WHEN** a client sends `?limit=5&limit=6`
- **THEN** the system responds with HTTP 400 in the standard error shape

