## ADDED Requirements

### Requirement: Occurrence resource representation

The system SHALL expose an `occurrences` route group whose read representation is
read from the derived `occurrences` table and carries, in this order:

- `permid`: the occurrence's permid (its root identification's);
- `collection`: a link to the occurrence's collection (label `name`);
- `reference`: a link to the **root identification's** reference, the
  publication the occurrence was first recorded from;
- `identification`: the winning identification, embedded (see "The embedded
  identification");
- `acceptedTaxon`: a link to the accepted concept of the identified taxon
  (label `name`), or `null` when the occurrence has no identified taxon or the
  identified taxon has no `taxa` row;
- `plantOrgans`: the organs as the derived table holds them, or absent when none;
- `abundance`: `{ value, unit }` from the occurrence's current, non-removed
  abundance (each key absent when not recorded), or `null` when there is none;
- `legacyIDs`: `{ oldpbdbID }`, the Classic `occurrence_no` as a string, when the
  occurrence was migrated.

`meta.type` SHALL be `occurrence`. The representation SHALL NOT expose internal
serial ids, `winning_identification_id`, the abundance's own permid, reference or
people, or `created_at`. The derived table's `removed` column SHALL NOT be read:
nothing writes it, and an occurrence whose root is removed has no row.

#### Scenario: Single occurrence read

- **WHEN** a client sends GET to the `occurrences` path with a `permid` that has a row
- **THEN** the system responds with HTTP 200 in the standard envelope
- **AND** `meta.type` is `occurrence`
- **AND** `data` carries `permid`, `collection`, `reference`, `identification`,
  `acceptedTaxon` and `abundance`, in that order, with `legacyIDs` last

#### Scenario: Occurrence not found

- **WHEN** a client sends GET to the `occurrences` path with a `permid` that has no row
- **THEN** the system responds with HTTP 404 in the standard error shape

#### Scenario: The occurrence's reference is the root's

- **WHEN** an occurrence whose winning identification is a reidentification citing
  a different reference is read
- **THEN** `reference` is the root identification's reference
- **AND** `identification.reference` is the reidentification's reference

#### Scenario: Accepted taxon of a synonym

- **WHEN** an occurrence identified as a junior synonym is read
- **THEN** `identification.taxon` is the synonym
- **AND** `acceptedTaxon` is the taxon whose permid is the synonym's concept permid

#### Scenario: An occurrence with no abundance

- **WHEN** an occurrence with no current abundance is read
- **THEN** `abundance` is `null`

#### Scenario: Internal columns are never exposed

- **WHEN** any occurrence is returned, singly or in a list
- **THEN** it carries no internal serial id, no `winningIdentificationId` and no
  `createdAt`

### Requirement: The embedded identification

An occurrence's `identification` SHALL be the identification the derived table
records as winning, as an object carrying, in this order:

- `permid`: the winning identification's permid (equal to the occurrence's when
  the root wins);
- `href`: the URL of that identification's full record,
  `<base>/api/v1/occurrences/{occurrence permid}/identifications/{identification permid}`;
- `name`: the formatted name (see "Formatted identification name");
- `genus`, `subgenus`, `species`, `subspecies`: the rank objects of the winner's
  name, each `{ resolution, name }` with absent keys for what was not given, placed
  directly in this object rather than under a nested `identification` key;
- `taxon`: a link to the identified taxon (see "An identified taxon with no taxa row");
- `reference`: a link to the winning identification's own reference.

It SHALL NOT carry `plantOrgans`, `comments` or `legacyIDs`; those are on the full
record.

#### Scenario: Ranks are lifted

- **WHEN** an occurrence identified as `Dielasma cf. bovidens` is read
- **THEN** `identification.genus` is `{ "name": "Dielasma" }`
- **AND** `identification.species` is `{ "resolution": "cf.", "name": "bovidens" }`
- **AND** `identification` has no `identification` key

#### Scenario: The embedded identification links to its full record

- **WHEN** an occurrence is read
- **THEN** a GET of `identification.href` responds with HTTP 200 and the full
  record of the identification whose permid is `identification.permid`

#### Scenario: Organs are not repeated on the winner

- **WHEN** an occurrence whose original identification names `leaf` and whose winning
  reidentification names no organ is read
- **THEN** `plantOrgans` is `["leaf"]`
- **AND** `identification` has no `plantOrgans`

### Requirement: An identified taxon with no taxa row

An identification's `taxon` link SHALL be `{ permid }` alone when its taxon permid
names no row of `taxa`. In detail, such a link SHALL be `{ permid }` alone, with no `name` and no `href`, in the embedded
identification and in the full record alike. The occurrence's `acceptedTaxon`
SHALL be `null`. An identification with no taxon permid SHALL have `taxon` `null`.

#### Scenario: An orphan taxon permid

- **WHEN** an occurrence whose `taxon_permid` names a root name opinion with no
  `taxa` row is read
- **THEN** `identification.taxon` is `{ "permid": <that permid> }`
- **AND** `acceptedTaxon` is `null`

#### Scenario: An unresolved identification

- **WHEN** an occurrence whose winning identification has no taxon permid is read
- **THEN** `identification.taxon` is `null` and `acceptedTaxon` is `null`

### Requirement: Formatted identification name

The embedded identification and the full identification record SHALL each carry
`name`, a display string composed from the rank objects in the order genus,
subgenus, species, subspecies:

- the subgenus SHALL be written in parentheses, its qualifier inside them;
- the resolutions `?`, `cf.`, `aff.` and `ex gr.` SHALL be written before the
  rank's name, separated by a space;
- the resolutions `n. gen.`, `n. subgen.`, `n. sp.`, `n. ssp.`, `sensu lato` and
  `sensu stricto` SHALL be written after the rank's name;
- the subspecies qualifiers `var`, `morph`, `forma` and `mut` SHALL be written
  before the subspecies name, as stored;
- the resolutions `informal` and `"` SHALL be left out, and the name kept;
- a rank with no name SHALL be skipped, and an identification with no rank name
  SHALL have `name` `null`.

Stored names such as `sp.` and `indet.` SHALL be written as they are; nothing is
added for a missing rank.

#### Scenario: Qualifiers before and after

- **WHEN** an identification has genus `{ resolution: "cf.", name: "Dielasma" }`
  and species `{ resolution: "n. sp.", name: "bovidens" }`
- **THEN** `name` is `cf. Dielasma bovidens n. sp.`

#### Scenario: Subgenus

- **WHEN** an identification has genus `Dielasma`, subgenus
  `{ resolution: "?", name: "Foo" }` and species `bar`
- **THEN** `name` is `Dielasma (? Foo) bar`

#### Scenario: Informal and ditto are not shown

- **WHEN** an identification has genus `{ resolution: "informal", name: "Bigfoot" }`
  and species `{ resolution: "\"", name: "sp." }`
- **THEN** `name` is `Bigfoot sp.`

#### Scenario: No name at all

- **WHEN** an identification has no rank objects
- **THEN** `name` is `null`

### Requirement: Occurrences are read-only and need the database

The `occurrences` route group SHALL be read-only (`resource-routes`): GET list and
single read are served, and POST, PUT, PATCH and DELETE answer HTTP 405. It SHALL
have no stub: with no PostgreSQL connection configured, its reads SHALL answer HTTP
503 in the standard error shape.

#### Scenario: A write verb is refused

- **WHEN** a client sends POST to `/api/v1/occurrences`
- **THEN** the system responds with HTTP 405 and an `Allow` header

#### Scenario: No database

- **WHEN** the app is built with no PostgreSQL connection and a client sends GET
  to `/api/v1/occurrences`
- **THEN** the system responds with HTTP 503

### Requirement: Occurrence lists are paginated in permid order

The `occurrences` list SHALL follow `list-pagination`, ordered by the number in the
occurrence's permid, and SHALL accept `ids`. Filters SHALL compose with `ids` and
pagination, narrowing the same set (logical AND).

#### Scenario: A bounded page

- **WHEN** a client sends `GET /api/v1/occurrences?limit=100`
- **THEN** `data` holds at most 100 occurrences in ascending permid-number order
- **AND** `links.next` resumes after the last one when more remain

### Requirement: Occurrence filters on links

The `occurrences` list SHALL accept these filters, each taking one permid:

- `collection`: the occurrences whose collection is the collection with that
  permid;
- `taxon`: the occurrences whose winning identification names exactly that taxon
  permid, matched as stored, with no synonym or subtaxon resolution;
- `withinTaxon`: the occurrences whose identified taxon is in the subtree of that
  taxon's accepted concept: the concept itself, every concept contained in it at
  any depth, and every name (synonym or spelling) of each of those concepts. A
  junior synonym's permid SHALL therefore select its senior's whole subtree.

A value that is not a permid of the filter's prefix (`COL` for `collection`, `TXN`
for `taxon` and `withinTaxon`) SHALL be rejected with HTTP 400 in the standard
error shape, naming the parameter. A well-formed permid that names nothing SHALL
yield an empty result with HTTP 200. `withinTaxon` SHALL never match an occurrence
whose taxon permid has no `taxa` row; `taxon` SHALL match it.

#### Scenario: Occurrences of a collection

- **WHEN** a client sends `GET /api/v1/occurrences?collection=<permid>`
- **THEN** every returned occurrence's `collection.permid` is that permid
- **AND** every occurrence of that collection is reachable through the pages

#### Scenario: Exact taxon

- **WHEN** a client sends `GET /api/v1/occurrences?taxon=<genus permid>`
- **THEN** every returned occurrence's `identification.taxon.permid` is that permid
- **AND** an occurrence identified as a species of that genus is not returned

#### Scenario: Subtree

- **WHEN** a client sends `GET /api/v1/occurrences?withinTaxon=<genus permid>`
- **THEN** occurrences identified as the genus, as any species in it, or as any
  synonym of either are returned

#### Scenario: A synonym selects its senior's subtree

- **WHEN** `withinTaxon` is a junior synonym's permid
- **THEN** the result equals the result for the senior synonym's permid

#### Scenario: Wrong prefix

- **WHEN** a client sends `GET /api/v1/occurrences?collection=TXN-1-00`
- **THEN** the system responds with HTTP 400 naming `collection`

#### Scenario: A well-formed permid matching nothing

- **WHEN** a client sends `GET /api/v1/occurrences?taxon=<a TXN permid no identification names>`
- **THEN** the system responds with HTTP 200 and an empty `data` array

#### Scenario: Filters combine

- **WHEN** a client sends `collection` and `withinTaxon` together
- **THEN** only occurrences matching both are returned

### Requirement: An occurrence's identifications

The system SHALL serve, read-only, under each occurrence:

- `GET /occurrences/{permid}/identifications`: every current, non-removed
  identification of that occurrence, the root included, as a list in the standard
  envelope, following `list-pagination` (ordered by permid number, so the root comes
  first) and accepting `ids`;
- `GET /occurrences/{permid}/identifications/{permid}`: one identification's full
  record.

`meta.type` SHALL be `identification`. The full record SHALL be the identification
read through its payload source: `permid`, `taxon`, `reference`, the stored
`identification` rank block, `plantOrgans`, `comments` and `legacyIDs`, plus the
formatted `name`. The ranks stay under `identification` here, as stored.

Both routes SHALL answer HTTP 404 when the occurrence does not exist. The single read
SHALL answer HTTP 404 when the identification does not exist or belongs to a
different occurrence. These routes SHALL expose no write verbs, and SHALL offer no
CSV.

#### Scenario: All identifications of an occurrence

- **WHEN** a client sends GET to the identifications of an occurrence with one
  reidentification
- **THEN** `data` holds two identifications, the root first

#### Scenario: Full record

- **WHEN** a client sends GET to one identification of an occurrence
- **THEN** `data` carries `permid`, `name`, `identification`, `taxon`, `reference`,
  and, when recorded, `plantOrgans`, `comments` and `legacyIDs`

#### Scenario: An identification of another occurrence

- **WHEN** a client requests `/occurrences/{A}/identifications/{B}` where B
  identifies a different occurrence
- **THEN** the system responds with HTTP 404

#### Scenario: Unknown occurrence

- **WHEN** a client requests the identifications of a permid that is not an occurrence
- **THEN** the system responds with HTTP 404

#### Scenario: CSV is not offered

- **WHEN** a client sends the identifications list with `Accept: text/csv`
- **THEN** the system responds with HTTP 406

### Requirement: Occurrence responses conform to their published schemas

Every occurrence read SHALL validate against the published `Occurrence` component,
derived from the read-only occurrence source (`payload-schema-variants`), and every
identification read against the published `Identification` component, derived from
the identification source's `out` variant plus `name`. The unit and integration
tests SHALL check both.

#### Scenario: Occurrence list conforms

- **WHEN** a page of occurrences is read from the integration database
- **THEN** each item is valid against the published `Occurrence` component

#### Scenario: Identification list conforms

- **WHEN** an occurrence's identifications are read
- **THEN** each item is valid against the published `Identification` component
