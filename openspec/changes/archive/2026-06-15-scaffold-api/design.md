## Context

PBDB2 is a ground-up redevelopment of the Paleobiology Database on a PostgreSQL
backend where each row stores a JSONB payload alongside relational metadata, a
stable `permid`, and an immutable version chain (`preceded_by_id` /
`succeeded_by_id`) with soft deletion. There is currently no API.

This change builds the API scaffold: a running Fastify service that fixes the
project's conventions before the harder work (database access, JWT auth, schema
validation, Swagger) begins. Those later concerns are deliberately reduced to
*seams* here — empty slots in the right shape — so they can be filled without
re-architecting. The response-envelope decision and its rationale are recorded
in `docs/api-response-envelope-comparison.md`; this document covers the
structural choices that realize it.

## Goals / Non-Goals

**Goals:**
- A Fastify app (JavaScript, ES modules) that builds, listens, and answers every
  route in the `{ data, meta, links }` envelope with `permid` as the identity key.
- Directory-based `/api/v1` versioning so `v2` is additive.
- All five resources (references, authorities, collections, specimens, schemas)
  reachable with full CRUD verb coverage, returning stubbed data.
- A write-verb auth seam (`fastify.authenticate`) that is a no-op today.
- A `node:test` + `app.inject()` test setup with smoke coverage.

**Non-Goals:**
- No database access — handlers return canned data.
- No real JWT verification, no `/login` route, no token issuance.
- No JSON Schema validation of request bodies, and no Swagger generation.
- No pagination mechanism implementation (offset/cursor); only the envelope
  slots (`links.next`/`prev`, `meta` counts) are reserved.
- No `/versions` history endpoints (the lineage exists in the DB but is not
  exposed yet).

## Decisions

### `build()` factory separate from server entry
`src/app.js` exports a `build(opts)` that creates, configures, and returns a
Fastify instance **without** calling `listen`. `src/server.js` imports it, reads
config, and listens. **Why:** `app.inject()` exercises routes in-process with no
socket, which is what makes `node:test` fast and parallel-safe. Alternative —
one file that builds and listens — was rejected because it forces tests to bind
real ports.

### Directory-based versioning via autoload
Routes live under `src/routes/api/v1/<resource>/` and are registered with
`@fastify/autoload` so the URL prefix is derived from the folder path. **Why:**
the version boundary becomes physical — `v2` is a sibling directory, not a
refactor. Alternative — a single hardcoded `/api/v1` prefix string — works but
couples every route to one manual prefix and makes multi-version coexistence
awkward.

### One encapsulated plugin per resource; shared envelope/route helpers
Each resource is a Fastify plugin owning its routes. References, authorities,
collections, and specimens are structurally uniform (permid-keyed CRUD) and
share an envelope helper (`reply.sendData` / `reply.sendList` or equivalent
decorators) so the `{ data, meta, links }` shape is produced in exactly one
place. `schemas` is implemented as its own plugin: its read representation is an
**aggregate** (`schema → characters → states` tree), so it does not reuse the
uniform single-record helper for GET. **Why:** centralizing the envelope
prevents drift; isolating `schemas` keeps the special case from leaking into the
common path. A fully generic route-factory for all five was rejected because
`schemas` would force leaky parameterization on day one.

### Auth as a decorator attached only to write verbs
`src/plugins/auth.js` decorates the instance with `fastify.authenticate`, a
`preHandler` that currently calls through (no-op). Route definitions attach it
to POST/PUT/PATCH/DELETE only. **Why:** the future JWT change becomes "make the
decorator real and add `/login`" with zero edits to resource routes — a clean,
single-seam swap. Alternative — inline auth checks per route — would scatter the
change surface across every file later.

### Stubbed handlers return realistically shaped data
Handlers return canned objects/arrays already wrapped in the final envelope with
plausible `permid`, `meta`, and `links` values. **Why:** consumers and tests can
build against the real contract now; wiring the database later changes the data
source, not the response shape.

### `node:test` with `app.inject()`, no test-runner dependency
Tests use Node's built-in runner (`node --test`) and `node:assert`, driving the
app through `app.inject()`. **Why:** zero dependencies, ESM-native, lean for a
young project; Vitest is the agreed fallback if watch/coverage ergonomics later
justify the dependency.

## Risks / Trade-offs

- **Stubs drift from the eventual DB shape** → Keep stub payloads minimal and
  envelope-focused; treat the spec scenarios (not the stub bodies) as the
  contract of record.
- **Envelope helper hardcodes assumptions that don't survive real data (e.g.
  `meta.version`, `links.history`)** → Reserve those slots now with null/empty
  values so the shape is fixed even though the values are placeholders; this is
  cheap now and awkward to retrofit.
- **`@fastify/autoload` adds a dependency and a layer of "magic" prefixing** →
  Acceptable: it directly enables the directory-based versioning goal, and the
  prefix behavior is well-documented and easy to verify with a smoke test.
- **A no-op `authenticate` could be mistaken for real protection** → The spec
  and a code comment must state explicitly that it is a pass-through stub; a
  test asserts only that it is *invoked* on write verbs, not that it denies.

## Open Questions

- Exact key names inside `meta` (e.g. `enterer`/`authorizer` vs nested
  `provenance`) — settle during implementation; does not affect the top-level
  `{ data, meta, links }` contract.
- Whether config loading needs `@fastify/env` now or a plain `src/config.js`
  reading `process.env` suffices for the scaffold (leaning plain).
