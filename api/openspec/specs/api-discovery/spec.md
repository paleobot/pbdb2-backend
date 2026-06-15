# api-discovery

## Purpose

Hypermedia discovery for the API base paths: `/`, `/api`, and `/api/v1` return
index documents whose links enumerate their children, so the API is
self-describing. Child links are derived from the registered route tree, keeping
discovery in sync with the routes that actually exist.

## Requirements

### Requirement: Base path discovery documents

The system SHALL serve an index/discovery document at each API base path — `/`,
`/api`, and `/api/v1` — using the standard `{ data, meta, links }` envelope.
`data` SHALL describe the node, `meta.type` SHALL be `index`, and `links` SHALL
include `self` plus one entry per immediate child path.

#### Scenario: Root lists its children

- **WHEN** a client requests `/`
- **THEN** the system responds with HTTP 200
- **AND** the body uses the `{ data, meta, links }` envelope with `meta.type` of
  `index`
- **AND** `links` includes `self` and a link to `/api`

#### Scenario: Version root lists its resources

- **WHEN** a client requests `/api/v1`
- **THEN** the system responds with HTTP 200
- **AND** `links` includes an entry for each resource route group (references,
  authorities, collections, specimens, schemas)

### Requirement: Discovery links derived from the route tree

The system SHALL derive each index document's child links from the registered
route tree rather than a hardcoded list: for a base path, the links SHALL be the
distinct next path-segments of every route registered beneath it. As routes are
added or removed (including future API versions), the discovery documents SHALL
reflect the change without separate edits.

#### Scenario: A newly added resource appears in discovery

- **WHEN** a new resource route group is registered under `/api/v1`
- **THEN** the `/api/v1` discovery document includes a link to it
- **AND** no hardcoded list needed to be updated

#### Scenario: Parameterized and duplicate child paths are collapsed

- **WHEN** a resource registers both a collection route and a `/:permid` route
- **THEN** the resource appears exactly once in the parent discovery document
