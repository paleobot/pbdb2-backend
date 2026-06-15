# api-foundation

## Purpose

The Fastify application skeleton for the PBDB2 API: how the app is constructed
and served, the versioned base path, the shared `{ data, meta, links }`
response envelope, and consistent HTTP error responses.

## Requirements

### Requirement: Application factory separate from server entry

The system SHALL expose a `build()` factory that constructs and returns a fully
configured Fastify instance without binding a network port, and a separate
server entry point that imports the factory and starts listening.

#### Scenario: Building the app without listening

- **WHEN** test or tooling code calls the `build()` factory
- **THEN** a configured Fastify instance is returned
- **AND** no network port is bound by the act of building

#### Scenario: Server entry starts listening

- **WHEN** the server entry point is run
- **THEN** it obtains an instance from the `build()` factory
- **AND** binds the configured host and port

### Requirement: Versioned API base path

The system SHALL serve all API routes under the `/api/v1` base path, with the
version segment derived from the route directory layout so that additional
versions can be introduced without modifying existing routes. The base paths
themselves (`/`, `/api`, `/api/v1`) SHALL be served as discovery documents
rather than returning 404.

#### Scenario: Routes are reachable under the version prefix

- **WHEN** a client requests a resource path under `/api/v1`
- **THEN** the request is routed to the corresponding resource handler

#### Scenario: Base paths return discovery documents

- **WHEN** a client requests one of the base paths `/`, `/api`, or `/api/v1`
- **THEN** the system responds with HTTP 200 and a discovery document

#### Scenario: Trailing slashes are tolerated

- **WHEN** a client requests a path with a trailing slash (for example `/api/v1/`)
- **THEN** the system responds as if the trailing slash were absent

#### Scenario: Unknown paths are not served

- **WHEN** a client requests a path that matches neither a route nor a base path
  (for example a misspelled resource)
- **THEN** the system responds with HTTP 404

### Requirement: Standard response envelope

The system SHALL return every successful response using a consistent envelope of
`data`, `meta`, and `links`. For a single resource, `data` SHALL be an object;
for a collection, `data` SHALL be an array and `meta` SHALL carry result counts.
The public identity of a resource SHALL be its `permid`, and internal database
identifiers SHALL NOT be exposed. The envelope SHALL reserve `meta.version`,
`links` relationship entries, and list pagination slots (`links.next`,
`links.prev`) even when their values are placeholders.

#### Scenario: Single resource response shape

- **WHEN** a client successfully requests a single resource
- **THEN** the response body contains `data`, `meta`, and `links`
- **AND** `data` is an object identified by a `permid`
- **AND** no internal serial identifier is present

#### Scenario: Collection response shape

- **WHEN** a client successfully requests a list of resources
- **THEN** `data` is an array
- **AND** `meta` includes result counts
- **AND** `links` includes `next` and `prev` slots

### Requirement: Consistent HTTP error responses

The system SHALL signal failures with appropriate HTTP status codes and a
structured error body, rather than returning success status codes for error
conditions.

#### Scenario: Unknown route

- **WHEN** a client requests a path that matches no route
- **THEN** the system responds with HTTP 404
- **AND** the body is a structured error object
