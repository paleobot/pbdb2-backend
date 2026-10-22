## MODIFIED Requirements

### Requirement: The API serves an OpenAPI 3.1 description of its reads

The system SHALL serve an OpenAPI 3.1 document describing the API's GET operations at
`/api/v1/openapi.json`, and a human-readable viewer of that document at `/api/v1/docs`. The
document SHALL be generated from the route schemas the application registers, not written by hand,
so that it describes the routes that exist. It SHALL be a valid OpenAPI 3.1 document. Neither route
uses the response envelope (`api-foundation`). The viewer SHALL carry PBDB branding, not the
framework's: its title is the version node's name, and its favicon and top-bar logo are PBDB's,
served from files in the repository rather than fetched from another site.

#### Scenario: The document is served

- **WHEN** a client requests `/api/v1/openapi.json`
- **THEN** the system responds with HTTP 200 and a JSON body whose `openapi` is a 3.1 version
- **AND** the body validates as an OpenAPI 3.1 document

#### Scenario: The viewer is served

- **WHEN** a client requests `/api/v1/docs`
- **THEN** the system responds with an HTML page that renders the document

#### Scenario: The viewer carries PBDB branding

- **WHEN** a client requests `/api/v1/docs`
- **THEN** the page's title is `PBDB2 API`
- **AND** its icon links point to the PBDB favicon, which the system serves, and not to the
  framework's default favicons
- **AND** the viewer's script replaces the top-bar logo with the PBDB emblem
