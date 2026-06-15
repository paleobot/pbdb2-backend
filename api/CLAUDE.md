# CLAUDE.md

Guidance for Claude Code working in this repository.

## Project

`pbdb2-api` — the REST API for PBDB2, a ground-up redevelopment of the
Paleobiology Database. Owned by the `paleobot` org
(https://github.com/paleobot/pbdb2-api).

The backend (separate repos: `pbdb2-dev`, `pbdb2-migrations`) is PostgreSQL,
JSONB-heavy: each resource row stores its domain content as a JSONB payload
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
- `.env*` files are git-ignored; `.env.example` is the exception and should be
  committed when environment variables are introduced.

## Commands

- `npm start` — run the server (`src/server.js`). Honors `HOST`, `PORT`,
  `NODE_ENV` (defaults: `0.0.0.0`, `3000`, `development`).
- `npm test` — run the test suite with the built-in Node runner (`node --test`).

## Layout

```
src/
  app.js                build() factory — configures Fastify, no listen()
  server.js             entry point — build() + listen()
  config.js             env → config
  lib/crud-routes.js    shared uniform-CRUD route factory
  plugins/              autoloaded first (fastify-plugin wrapped, global)
    envelope.js         reply.sendData / reply.sendList → { data, meta, links }
    auth.js             stubbed fastify.authenticate (no-op preHandler)
    sensible.js         @fastify/sensible
  routes/api/v1/        autoloaded; URL prefix derived from directory layout
    references/  authorities/  collections/  specimens/   uniform CRUD
    schemas/            CRUD + aggregate schema→characters→states read
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
  Replace the decorator body without touching routes.
- **Tests:** `node:test` + `node:assert` driven through `app.inject()`. No
  test-runner dependency. Vitest is the agreed fallback if watch/coverage
  ergonomics later justify it.

## Deferred (not yet built)

PostgreSQL integration, request-body validation and Swagger generation from the
`pbdb2-dev` JSON Schemas, real JWT auth + login, pagination mechanism
(cursor vs offset — the envelope already reserves `links.next`/`prev`), and the
per-entity `/versions` history sub-resource.

## OpenSpec workflow

This project is spec-driven via OpenSpec (`openspec/config.yaml`,
`schema: spec-driven`). Established capability specs live in `openspec/specs/`
(`api-foundation`, `auth-stub`, `resource-routes`); completed changes are in
`openspec/changes/archive/`. The workflow is exposed as skills/slash commands:

- `/opsx:explore` — think through an idea before committing to a change.
- `/opsx:propose` — create a change with its design, specs, and tasks.
- `/opsx:apply` — implement the tasks from a proposed change.
- `/opsx:sync` — sync delta specs into the main specs.
- `/opsx:archive` — finalize and archive a completed change.

Prefer this flow for non-trivial work: propose → apply → sync/archive. New work
modifies the specs in `openspec/specs/` via change deltas rather than editing
them directly.
