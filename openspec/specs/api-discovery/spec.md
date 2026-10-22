# api-discovery

## Purpose

Hypermedia discovery for the API base paths: `/`, `/api`, and `/api/v1` return
index documents that list their children in `data.resources`, so the API is
self-describing; their `links` hold only registered link relations, among them
the version's API description. Children are derived from the registered route
tree, keeping discovery in sync with the routes that actually exist.

## Requirements

### Requirement: Base path discovery documents

The system SHALL serve an index/discovery document at each API base path — `/`,
`/api`, and `/api/v1` — using the standard `{ data, meta, links }` envelope.
`data` SHALL describe the node, and `meta.type` SHALL be `index`.

`data.resources` SHALL list the node's children: one entry per immediate child
path, keyed by the child's path segment, each an object whose `href` is an
absolute URL, the public base URL (`api-foundation`) followed by the path. An
entry SHALL be an object rather than a bare URL, so that fields added beside
`href` later are additive.

`links` SHALL hold only registered link relations, never a child's name. It SHALL
include `self`. The `/api/v1` document SHALL also link the API description by the
relations RFC 8631 defines (`api-description`): `links["service-desc"]` SHALL be
`<base>/api/v1/openapi.json` and `links["service-doc"]` SHALL be
`<base>/api/v1/docs`. These two links SHALL appear only on the version's index,
not on `/` or `/api`.

#### Scenario: Root lists its children

- **WHEN** a client requests `/`
- **THEN** the system responds with HTTP 200
- **AND** the body uses the `{ data, meta, links }` envelope with `meta.type` of
  `index`
- **AND** `data.resources.api.href` is `<base>/api`, where `<base>` is the public
  base URL
- **AND** `links` is exactly `{ self }`, with `self` as `<base>/`

#### Scenario: Version root lists its resources

- **WHEN** a client requests `/api/v1`
- **THEN** the system responds with HTTP 200
- **AND** `data.resources` has an entry for each documented resource route group
  (references, authorities, collections, schemas, taxa), each with an `href`
- **AND** `data.resources` has no entry for `specimens`, whose routes are hidden
  while its reads are stubbed (`api-description`)

#### Scenario: Version root links its description

- **WHEN** a client requests `/api/v1`
- **THEN** `links["service-desc"]` is `<base>/api/v1/openapi.json`
- **AND** `links["service-doc"]` is `<base>/api/v1/docs`
- **AND** neither `openapi.json` nor `docs` appears in `data.resources`

#### Scenario: Links hold only relations

- **WHEN** a client requests any of `/`, `/api` or `/api/v1`
- **THEN** every key of `links` is a registered link relation (`self`, and on
  `/api/v1` `service-desc` and `service-doc`)
- **AND** no child path name appears in `links`

#### Scenario: Higher nodes do not link the description

- **WHEN** a client requests `/` or `/api`
- **THEN** `links` has no `service-desc` and no `service-doc`

### Requirement: Discovery links derived from the route tree

The system SHALL derive each index document's children (`data.resources`) from
the registered route tree rather than a hardcoded list: for a base path, the
children SHALL be the distinct next path-segments of every route registered
beneath it that is not hidden from the API description (`schema.hide`). A segment
SHALL be listed when at least one non-hidden route lies under it, so hiding a
group's write routes does not remove the group, and hiding every route of a group
does. As routes are added or removed (including future API versions), the
discovery documents SHALL reflect the change without separate edits.

#### Scenario: A newly added resource appears in discovery

- **WHEN** a new resource route group is registered under `/api/v1`
- **THEN** the `/api/v1` discovery document includes an entry for it in
  `data.resources`
- **AND** no hardcoded list needed to be updated

#### Scenario: Parameterized and duplicate child paths are collapsed

- **WHEN** a resource registers both a collection route and a `/:permid` route
- **THEN** the resource appears exactly once in the parent's `data.resources`

#### Scenario: A hidden route is not listed

- **WHEN** every route under a path segment is marked hidden from the description
- **THEN** that segment has no entry in its parent's `data.resources`

#### Scenario: Hidden write routes do not hide their resource

- **WHEN** a group's write routes are hidden and its GET routes are not
- **THEN** the group still has an entry in its parent's `data.resources`

