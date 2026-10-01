# CLAUDE.md

Guidance for Claude Code working in this repository.

## Project

The REST API for PBDB2, a ground-up redevelopment of the Paleobiology
Database. It lives in `api/` of the `pbdb2-backend` monorepo
(https://github.com/paleobot/pbdb2-backend), next to the DDL (`db/`), the
payload schemas (`payloadSchemas/`) and the migrations (`migrations/`); it was
the separate `pbdb2-api` repo until 2026-10-01. Nothing in `api/` may import
or read from `migrations/` (`tests/repository-layout.test.js` enforces it).

The backend database is PostgreSQL, JSONB-heavy: each resource row stores its domain content as a JSONB payload
alongside relational metadata, a stable `permid`, and an immutable version chain
(`preceded_by_id` / `succeeded_by_id`) with soft deletion (`removed`). This API
does not yet talk to that database — handlers currently return stubbed data.

## Stack & conventions

- **Runtime:** Node.js, ES modules (`"type": "module"` — use `import`/`export`,
  not `require`).
- **Framework:** [Fastify](https://fastify.dev/) v5.
- **Identity:** `permid` is the public identifier for every resource. Internal
  serial database ids are never exposed.
- **License:** ISC.
- One `.env` for the whole backend, at the repository root (copy the root
  `.env.example`); never `api/.env`. `src/server.js` and the integration
  harness load it by path, so any working directory works. A relative
  `PG_CA_CERT` resolves against the repository root. New variables go in the
  root `.env.example`.

## Commands

Run from the repository root (`npm install` there installs every workspace;
there is no `api/package-lock.json`):

- `npm start -w api` — run the server (`src/server.js`). Honors `HOST`, `PORT`,
  `NODE_ENV` (defaults: `0.0.0.0`, `3000`, `development`).
- `npm test -w api` — the API's unit tests (`node --test`, no database).
  The root `npm test` runs them along with every other area's tests.
- `npm run test:integration` — the API's integration suite against an
  ephemeral database built from the DDL in `db/` (`DDL_DIR` overrides).

## Layout

Paths below are relative to `api/` (as are paths in the API's specs; see
`openspec/specs/repository-layout`).

```
src/
  app.js                build() factory — configures Fastify, no listen()
  server.js             entry point — build() + listen()
  config.js             env → config
  lib/crud-routes.js    shared CRUD route factory (readOnly option → 405)
  plugins/              autoloaded first (fastify-plugin wrapped, global)
    envelope.js         reply.sendData / reply.sendList → { data, meta, links }
    auth.js             stubbed fastify.authenticate (no-op preHandler)
    sensible.js         @fastify/sensible
  routes/api/v1/        autoloaded; URL prefix derived from directory layout
    references/  authorities/  collections/  specimens/   uniform CRUD
    schemas/            CRUD + aggregate schema→characters→states read
    taxa/               READ-ONLY (405 on writes); derived table, no JSONB
test/                   node:test suites, driven via app.inject()
docs/                   design notes (e.g. response-envelope rationale)
```

### Key patterns

- **`build()` vs `server.js`:** `src/app.js` exports `build()`, which returns a
  configured instance **without** listening. `src/server.js` calls it and
  listens. This split is what lets tests use `app.inject()` (in-process, no
  socket) — keep it intact.
- **Response envelope:** every successful response is `{ data, meta, links }`,
  produced only via the `reply.sendData` / `reply.sendList` decorators in
  `plugins/envelope.js`. Single resource → `data` is an object; list → `data` is
  an array with counts in `meta`. The rationale and the comparison against the
  legacy `data1.2` envelope are in `docs/api-response-envelope-comparison.md`.
- **Versioning:** `/api/v1` is derived from the `routes/api/v1/` directory via
  `@fastify/autoload`. A future `v2` is a new sibling directory, not a rewrite.
- **Auth seam:** write verbs (POST/PUT/PATCH/DELETE) attach the
  `fastify.authenticate` preHandler; GET is open. `authenticate` is currently a
  **no-op stub** — real JWT verification and a login route are a future change.
  Replace the decorator body without touching routes. A **read-only** group
  (`taxa`) attaches no preHandler to its write verbs: they answer 405, so a
  refused method never presents as an auth failure.
- **`taxa` is the exception to almost everything.** It is materialized output of
  the backend's `derive_taxa()`: no JSONB payload, no version chain, no write
  path, and `removed` is never written. It therefore has its own
  `lib/taxa-repository.js` (the generic one would emit SQL referencing columns
  that do not exist) but reuses the shared `linkProjections()`. Its decisions and
  their evidence are in `openspec/changes/add-taxa-reads/design.md`; the
  measurements are in `docs/taxa-classification-reads.md`.
- **Strict query params:** an unrecognized query parameter is a **400** naming it,
  on single reads as well as lists. Filter *values* stay opaque (a well-formed
  value matching nothing is an empty 200). A resource declares what it accepts
  via its descriptor's `filters` and `expansions`.
- **Tests:** `node:test` + `node:assert` driven through `app.inject()`. No
  test-runner dependency. Vitest is the agreed fallback if watch/coverage
  ergonomics later justify it.

## Deferred (not yet built)

Request-body validation and Swagger generation from the payload schemas in
`payloadSchemas/`, real JWT auth + login, the write path (for taxonomy that means the
*opinion* tables — `taxa` itself is never written), the per-entity `/versions`
history sub-resource (`taxa` will never have one — it is not version-chained),
and name-ordered taxa lists (viable but needs a `(name, permid)` index in
`db/`; the opaque cursor keeps it open).

PostgreSQL integration and pagination have LANDED — `add-reads-pg-layer` and
`add-pagination` respectively — despite previously being listed here.

## OpenSpec workflow

The backend is spec-driven via one OpenSpec root at the repository root
(`openspec/config.yaml`, `schema: spec-driven`), shared with the DDL, payload
schemas and migrations. The API's capability specs (`api-discovery`,
`api-foundation`, `auth-stub`, `data-access`, `list-pagination`,
`reference-enrichment`, `resource-routes`, `taxa-reads`) live in
`openspec/specs/` with the others; completed changes are in
`openspec/changes/archive/`. The workflow is exposed as skills/slash commands:

- `/opsx:explore` — think through an idea before committing to a change.
- `/opsx:new` or `/opsx:ff` — create a change (step by step, or all artifacts at once).
- `/opsx:apply` — implement the tasks from a proposed change.
- `/opsx:sync` — sync delta specs into the main specs.
- `/opsx:archive` — finalize and archive a completed change.

Prefer this flow for non-trivial work: new/ff → apply → sync/archive. New work
modifies the specs in `openspec/specs/` via change deltas rather than editing
them directly.
