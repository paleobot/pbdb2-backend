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
include `self` plus one entry per immediate child path, each an absolute URL: the
public base URL (`api-foundation`) followed by the path.

The `/api/v1` document SHALL also link the API description by relation:
`links.describedby` SHALL be `<base>/api/v1/openapi.json` and `links.docs` SHALL be
`<base>/api/v1/docs` (`api-description`). These links SHALL appear only on the
version's index, not on `/` or `/api`.

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
- **AND** `links` includes an entry for each documented resource route group
  (references, authorities, collections, schemas, taxa)
- **AND** `links` has no entry for `specimens`, whose routes are hidden while its
  reads are stubbed (`api-description`)

#### Scenario: Version root links its description

- **WHEN** a client requests `/api/v1`
- **THEN** `links.describedby` is `<base>/api/v1/openapi.json`
- **AND** `links.docs` is `<base>/api/v1/docs`
- **AND** neither `openapi.json` nor `docs` appears as a resource entry

#### Scenario: Higher nodes do not link the description

- **WHEN** a client requests `/` or `/api`
- **THEN** `links` has no `describedby` and no `docs`

### Requirement: Discovery links derived from the route tree

The system SHALL derive each index document's child links from the registered
route tree rather than a hardcoded list: for a base path, the links SHALL be the
distinct next path-segments of every route registered beneath it that is not
hidden from the API description (`schema.hide`). A segment SHALL be listed when
at least one non-hidden route lies under it, so hiding a group's write routes
does not remove the group, and hiding every route of a group does. As routes are
added or removed (including future API versions), the discovery documents SHALL
reflect the change without separate edits.

#### Scenario: A newly added resource appears in discovery

- **WHEN** a new resource route group is registered under `/api/v1`
- **THEN** the `/api/v1` discovery document includes a link to it
- **AND** no hardcoded list needed to be updated

#### Scenario: Parameterized and duplicate child paths are collapsed

- **WHEN** a resource registers both a collection route and a `/:permid` route
- **THEN** the resource appears exactly once in the parent discovery document

#### Scenario: A hidden route is not listed

- **WHEN** every route under a path segment is marked hidden from the description
- **THEN** that segment has no entry in its parent discovery document

#### Scenario: Hidden write routes do not hide their resource

- **WHEN** a group's write routes are hidden and its GET routes are not
- **THEN** the group still has an entry in its parent discovery document

