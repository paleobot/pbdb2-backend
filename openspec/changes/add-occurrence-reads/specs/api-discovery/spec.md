## MODIFIED Requirements

### Requirement: Base path discovery documents

The system SHALL serve an index/discovery document at each API base path — `/`,
`/api`, and `/api/v1` — using the standard `{ data, meta, links }` envelope.
`data` SHALL describe the node, and `meta.type` SHALL be `index`.

`data.resources` SHALL list the node's children: one entry per immediate child
path, keyed by the child's path segment, each an object whose `href` is an
absolute URL, the public base URL (`api-foundation`) followed by the path. An
entry SHALL be an object rather than a bare URL, so that fields added beside
`href` later are additive. Routes nested under a resource (such as an
occurrence's identifications) are not children of the version root.

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
  (references, authorities, collections, schemas, taxa, occurrences), each with an
  `href`
- **AND** `data.resources` has no entry for `specimens`, whose routes are hidden
  while its reads are stubbed (`api-description`)
- **AND** `data.resources` has no entry for `identifications`

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
