## ADDED Requirements

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
