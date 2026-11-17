## MODIFIED Requirements

### Requirement: Base path discovery documents

The system SHALL serve an index/discovery document at each API base path — `/`,
`/api`, and `/api/v1` — using the standard `{ data, meta, links }` envelope.
`data` SHALL describe the node, `meta.type` SHALL be `index`, and `links` SHALL
include `self` plus one entry per immediate child path, each an absolute URL: the
public base URL (`api-foundation`) followed by the path.

#### Scenario: Root lists its children

- **WHEN** a client requests `/`
- **THEN** the system responds with HTTP 200
- **AND** the body uses the `{ data, meta, links }` envelope with `meta.type` of
  `index`
- **AND** `links` includes `self` as `<base>/` and a link to `/api` as `<base>/api`,
  where `<base>` is the public base URL

#### Scenario: Version root lists its resources

- **WHEN** a client requests `/api/v1`
- **THEN** the system responds with HTTP 200
- **AND** `links` includes an entry for each resource route group (references,
  authorities, collections, specimens, schemas, taxa)
