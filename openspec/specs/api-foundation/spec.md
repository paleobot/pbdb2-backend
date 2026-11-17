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

A collection response SHALL be returned in a total, stable order of `permid`.
This ordering is a guarantee of the list contract, not an implementation detail:
cursor pagination depends on it to avoid skipping or repeating records.

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
- **THEN** `data` is an array ordered by `permid`
- **AND** `meta` includes result counts for the returned page
- **AND** `links` includes `next` and `prev`, each either a URL or `null`

#### Scenario: The description is not enveloped

- **WHEN** a client requests `/api/v1/openapi.json`
- **THEN** the body is the OpenAPI document itself, with no `data`, `meta` or `links` wrapper

### Requirement: Consistent HTTP error responses

The system SHALL signal failures with appropriate HTTP status codes and a
structured error body, rather than returning success status codes for error
conditions.

#### Scenario: Unknown route

- **WHEN** a client requests a path that matches no route
- **THEN** the system responds with HTTP 404
- **AND** the body is a structured error object

### Requirement: Public base URL

The system SHALL take a public base URL from configuration (`PUBLIC_BASE_URL` in
the backend root `.env`) and SHALL NOT derive it from the request's `Host` or
`X-Forwarded-*` headers. The base SHALL be an absolute `http:` or `https:` URL
with no query, fragment or credentials; it MAY carry a path, for a proxy that
mounts the API under a prefix. A trailing `/` SHALL be removed. An invalid base
SHALL make `build()` throw.

When `PUBLIC_BASE_URL` is unset, the configured value SHALL default to
`http://localhost:<PORT>`. The server entry point SHALL refuse to start when it is
unset and `NODE_ENV` is not `development`. The `build()` factory SHALL accept the
base as an option and, when it is omitted, SHALL use a fixed default
(`http://localhost:3000`) rather than reading the environment.

#### Scenario: A trailing slash is removed

- **WHEN** the app is built with base `https://pbdb2.example.org/`
- **THEN** links begin `https://pbdb2.example.org/api/v1/`, with no doubled slash

#### Scenario: An invalid base is rejected

- **WHEN** the app is built with a base that is relative, is not `http:` or
  `https:`, or carries a query, fragment or credentials
- **THEN** `build()` throws

#### Scenario: Request headers do not change the base

- **WHEN** a request arrives with a `Host` or `X-Forwarded-Host` header naming
  another host
- **THEN** every link in the response still begins with the configured base

#### Scenario: Production requires an explicit base

- **WHEN** the server entry point runs with `NODE_ENV` other than `development`
  and no `PUBLIC_BASE_URL`
- **THEN** it exits with an error naming `PUBLIC_BASE_URL`, without listening

#### Scenario: build() ignores the environment by default

- **WHEN** `build()` is called with no base option while `PUBLIC_BASE_URL` is set
  in the environment
- **THEN** links begin with `http://localhost:3000`

### Requirement: Links are absolute URLs

Every link in a response body SHALL be an absolute URL formed as the public base
URL followed by the path the API addresses: the envelope's `links.self` on single,
list and index responses (the request's path and query as received); the list
pagination links `links.next` and `links.prev` when not `null`; the discovery
documents' child links; and every `href` hydrated on a link object in `data`,
including each entry of a taxon's `containingTaxa` chain. No response SHALL mix
absolute URLs with root-relative paths. Paths, query strings and permids SHALL be
unchanged by the base.

#### Scenario: Envelope self is absolute

- **WHEN** a client requests `/api/v1/collections?limit=2` from an app whose base
  is `https://pbdb2.example.org/base`
- **THEN** `links.self` is
  `https://pbdb2.example.org/base/api/v1/collections?limit=2`

#### Scenario: Pagination links are absolute

- **WHEN** a list response has a further page
- **THEN** `links.next` begins with the base and otherwise carries the request's
  path and query plus the `cursor`
- **AND** requesting it returns the following records

#### Scenario: Link hrefs are absolute

- **WHEN** a response carries a hydrated link object, whether declared in a
  payload source, on a descriptor, or in a `containingTaxa` chain
- **THEN** its `href` is the base followed by the target group's path and the
  link's `permid`

#### Scenario: Discovery links are absolute

- **WHEN** a client requests `/api/v1`
- **THEN** `links.self` and every child link begin with the base

