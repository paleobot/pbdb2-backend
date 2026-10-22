## ADDED Requirements

### Requirement: The API serves an OpenAPI 3.1 description of its reads

The system SHALL serve an OpenAPI 3.1 document describing the API's GET operations at
`/api/v1/openapi.json`, and a human-readable viewer of that document at `/api/v1/docs`. The
document SHALL be generated from the route schemas the application registers, not written by hand,
so that it describes the routes that exist. It SHALL be a valid OpenAPI 3.1 document. Neither route
uses the response envelope (`api-foundation`).

#### Scenario: The document is served

- **WHEN** a client requests `/api/v1/openapi.json`
- **THEN** the system responds with HTTP 200 and a JSON body whose `openapi` is a 3.1 version
- **AND** the body validates as an OpenAPI 3.1 document

#### Scenario: The viewer is served

- **WHEN** a client requests `/api/v1/docs`
- **THEN** the system responds with an HTML page that renders the document

### Requirement: Every documented operation states its parameters and its response

Every GET operation in the document SHALL list each query parameter the route accepts, with its type,
bounds and, for a parameter whose field declares an inline `enum`, its legal values in order. Rules
that span parameters or that the route enforces in code SHALL be stated in the parameter's
`description`: `ids` cannot be combined with `limit` or `cursor`; `ids` holds at most 100 distinct
permids; a `cursor` is opaque and is obtained from `links.next` / `links.prev`. Each operation
SHALL describe its HTTP 200 response as the envelope with its `data` schema.

#### Scenario: A list's filters are discoverable

- **WHEN** the document's `GET /api/v1/references` operation is read
- **THEN** it lists `ids`, `limit`, `cursor` and `publicationType`
- **AND** `limit` is an integer with minimum 1 and maximum 1000
- **AND** `publicationType` lists the reference source's publication types in enum order

#### Scenario: An expansion is discoverable

- **WHEN** the document's `GET /api/v1/taxa` operation is read
- **THEN** it lists `includeContainingTaxa` as a boolean

### Requirement: The document covers exactly the operations a client can rely on

The document SHALL contain every GET operation that the discovery documents reach, and SHALL NOT
contain an operation whose response is not real data. The stub write routes, the read-only `taxa`
group's 405 write routes, every `specimens` route (stub reads), and the description's own routes
SHALL be hidden from it. A hidden route still answers as before.

#### Scenario: Coverage matches discovery

- **WHEN** the GET paths reachable from `/api/v1` discovery are compared with the document's paths
- **THEN** each reachable path has a GET operation in the document, single reads included

#### Scenario: Stubs and write verbs are absent

- **WHEN** the document is read
- **THEN** it contains no POST, PUT, PATCH or DELETE operation and no `specimens` path

### Requirement: The published schemas describe the contract, not storage

The component schemas in the document SHALL be derived from the payload sources' `out` variants,
transformed for publication:
- the storage annotations `x-storage`, `x-enumFrom`, `codec` and `x-variant`, and `$schema` and
  `$id`, SHALL be removed;
- a property carrying `x-enumFrom` SHALL be published as a string whose `description` names its
  vocabulary in words and says curators may add values; its values SHALL NOT be listed;
- each `x-link` node SHALL be replaced by a reference to a generated component named for its target
  (`ReferenceLink`, `AuthorityLink`, `TaxonLink`), keeping `null` where `out` allows it; the
  component SHALL describe the link's fields and name its target's URL pattern. Two link
  declarations naming the same target with different labels SHALL make generation fail;
- the schema tree's nodes (`Character`, `State`) and the taxon containing chain
  (`ContainingTaxon`) SHALL be named, recursive components;
- no `x-` keyword SHALL remain in the document.

Descriptions SHALL NOT name tables or columns.

#### Scenario: A link is a named type

- **WHEN** the published `Collection` schema is read
- **THEN** `primaryReference` is a `ReferenceLink` or `null`, and `additionalReferences` is an array
  of `ReferenceLink`

#### Scenario: Storage does not leak

- **WHEN** the document is searched
- **THEN** it contains no `x-storage`, `x-enumFrom`, `x-link` or `codec` key, no `dictionaries.`
  qualified name, and no child-table name such as `additional_collection_refs`

#### Scenario: A dictionary field is named, not enumerated

- **WHEN** the published `Collection` schema's `lithofacies` items' `lithology` is read
- **THEN** it is a string with a description naming its vocabulary, and it has no `enum`

### Requirement: Responses conform to the published schemas without being reshaped

Every documented GET response SHALL validate against the schema the document publishes for it.
Tests SHALL validate real responses against the **published** schemas (after the publication
transform), for every documented resource, single reads and lists. The response schema SHALL NOT
alter the body: responses SHALL be serialized as the handler built them, so that a field missing
from a schema can never be dropped, coerced or blanked in a response.

#### Scenario: Real responses validate

- **WHEN** a single read and a list of each documented resource are validated against the published
  schemas
- **THEN** every response is valid

#### Scenario: An undeclared field is not dropped

- **WHEN** a handler's result carries a field its response schema does not declare
- **THEN** the field is present in the response body as the handler built it
