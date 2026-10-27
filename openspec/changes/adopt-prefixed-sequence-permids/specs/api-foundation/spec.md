## MODIFIED Requirements

### Requirement: Standard response envelope

The system SHALL return every successful response using a consistent envelope of
`data`, `meta`, and `links`, except the API description's routes
(`/api/v1/openapi.json`, an OpenAPI document, and `/api/v1/docs`, an HTML viewer;
`api-description`), whose formats are defined by OpenAPI and HTML. For a single resource, `data` SHALL be an object;
for a collection, `data` SHALL be an array and `meta` SHALL carry result counts
describing the returned page. The public identity of a resource SHALL be its
`permid`, and internal database identifiers SHALL NOT be exposed.

The envelope SHALL NOT carry placeholder fields: a field whose value cannot vary
under the current design SHALL be absent rather than reserved. A single
resource's `meta` SHALL therefore be `{ type }`, with no `removed` and no
`version`: a read serves only a current, non-removed head, so neither could hold
anything but a constant, and versions share their lineage's `permid`, so no
public identifier exists for a previous version. Version fields return, with
real values, alongside the version-history sub-resource. A single resource's
`links` SHALL be `{ self }`; relationships to other resources are inline links in
`data` (`reference-enrichment`), not entries in `links`.

The list pagination slots (`links.next`, `links.prev`) SHALL carry real values:
a URL when a further page exists in that direction, and `null` when it does not.
They SHALL NOT be permanent placeholders.

A collection response SHALL be returned in a total, stable order of `permid` by
the number it contains (`list-pagination`). This ordering is a guarantee of the
list contract, not an implementation detail: cursor pagination depends on it to
avoid skipping or repeating records.

#### Scenario: Single resource response shape

- **WHEN** a client successfully requests a single resource
- **THEN** the response body contains `data`, `meta`, and `links`
- **AND** `data` is an object identified by a `permid`
- **AND** no internal serial identifier is present

#### Scenario: Single resource meta carries only its type

- **WHEN** a client successfully requests a single resource, including a taxon
- **THEN** `meta` is exactly `{ type }`
- **AND** `meta` has no `removed` and no `version`
- **AND** `links` is exactly `{ self }`

#### Scenario: Collection response shape

- **WHEN** a client successfully requests a list of resources
- **THEN** `data` is an array ordered by the number in each record's `permid`
- **AND** `meta` includes result counts for the returned page
- **AND** `links` includes `next` and `prev`, each either a URL or `null`

#### Scenario: The description is not enveloped

- **WHEN** a client requests `/api/v1/openapi.json`
- **THEN** the body is the OpenAPI document itself, with no `data`, `meta` or `links` wrapper
