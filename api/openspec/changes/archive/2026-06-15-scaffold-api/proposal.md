## Why

PBDB2 has a PostgreSQL backend under active development but no API to access it.
We need a running, well-structured Fastify scaffold that establishes the
project's conventions — versioned routing, the `{ data, meta, links }` response
envelope, the auth seam, and the test approach — so that subsequent sessions
(database integration, JWT auth, schema validation, Swagger) drop into slots
that already exist rather than forcing rework.

## What Changes

- Introduce a Fastify application (JavaScript, ES modules) split into a
  `build()` factory (configures the instance, does not listen) and a separate
  server entry point that listens. This split is what makes in-process testing
  fast.
- Serve all routes under `/api/v1`, with the version prefix derived from the
  directory layout (directory-based path versioning) so a future `v2` is a new
  folder, not a rewrite.
- Add five resource route groups — `references`, `authorities`, `collections`,
  `specimens`, `schemas` — each exposing CRUD across HTTP verbs. Handlers return
  canned/stubbed responses; no database access yet.
- Standardize every response on the `{ data, meta, links }` envelope, with
  `permid` as the public identity key. Single records return an object in
  `data`; lists return an array plus result counts in `meta`.
- Add a stubbed authentication seam: a `fastify.authenticate` decorator
  (currently a no-op `preHandler`) attached to all write verbs
  (POST/PUT/PATCH/DELETE). Read verbs are open. Real JWT verification and a
  `/login` route are explicitly deferred.
- Establish the test approach: `node:test` with Fastify's `app.inject()`, plus
  smoke tests proving the app builds and routes respond in the expected
  envelope shape.

## Capabilities

### New Capabilities
- `api-foundation`: The Fastify application skeleton — `build()`/server split,
  configuration loading, the `/api/v1` directory-based version prefix, the
  shared `{ data, meta, links }` response envelope, and consistent HTTP error
  responses.
- `resource-routes`: The five CRUD resource groups (references, authorities,
  collections, specimens, schemas) with stubbed handlers, including the
  `schemas` aggregate read shape and `permid`-keyed addressing.
- `auth-stub`: The write-verb protection seam — a `fastify.authenticate`
  decorator applied to POST/PUT/PATCH/DELETE that is a no-op pass-through today
  and becomes real JWT verification in a future change.

### Modified Capabilities
<!-- None — this is a greenfield scaffold; no existing specs. -->

## Impact

- **New code:** `src/` (app factory, server entry, config, plugins, route
  groups, response/envelope helpers), `test/` (node:test smoke tests).
- **Dependencies:** adds `fastify` (and likely `@fastify/sensible` and
  `@fastify/autoload`); no test-runner dependency (`node:test` is built in).
- **`package.json`:** real `start` and `test` scripts replace the placeholder;
  confirms ESM (`"type"` set for ES modules).
- **Deferred (future changes, not this one):** PostgreSQL integration, JSON
  Schema validation from the pbdb2-dev definitions, Swagger/OpenAPI generation,
  real JWT auth + login, and the per-entity `/versions` history sub-resource.
- **No breaking changes** — there is no prior API.
