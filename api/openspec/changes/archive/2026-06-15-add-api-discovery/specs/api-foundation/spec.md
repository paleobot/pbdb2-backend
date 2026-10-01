## MODIFIED Requirements

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
