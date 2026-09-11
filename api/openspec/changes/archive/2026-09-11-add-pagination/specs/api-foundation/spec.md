## MODIFIED Requirements

### Requirement: Standard response envelope

The system SHALL return every successful response using a consistent envelope of
`data`, `meta`, and `links`. For a single resource, `data` SHALL be an object;
for a collection, `data` SHALL be an array and `meta` SHALL carry result counts
describing the returned page. The public identity of a resource SHALL be its
`permid`, and internal database identifiers SHALL NOT be exposed. The envelope
SHALL reserve `meta.version` and `links` relationship entries even when their
values are placeholders.

The list pagination slots (`links.next`, `links.prev`) SHALL carry real values:
a URL when a further page exists in that direction, and `null` when it does not.
They SHALL NOT be permanent placeholders.

A collection response SHALL be returned in a total, stable order of `permid`.
This ordering is a guarantee of the list contract, not an implementation detail:
cursor pagination depends on it to avoid skipping or repeating records.

#### Scenario: Single resource response shape

- **WHEN** a client successfully requests a single resource
- **THEN** the response body contains `data`, `meta`, and `links`
- **AND** `data` is an object identified by a `permid`
- **AND** no internal serial identifier is present

#### Scenario: Collection response shape

- **WHEN** a client successfully requests a list of resources
- **THEN** `data` is an array ordered by `permid`
- **AND** `meta` includes result counts for the returned page
- **AND** `links` includes `next` and `prev`, each either a URL or `null`
