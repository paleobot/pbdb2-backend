## Context

The API handlers return stubbed data; no PostgreSQL connection exists. The
backend (`pbdb2-migrations/postgresql/create_new.sql`) is JSONB-heavy and
**append-only**: each row carries a `jsonb` payload, a stable `permid`, an
immutable version chain (`preceded_by_id` / `succeeded_by_id`), and soft deletion
(`removed`). Critically, **versioning lives in the database**: plpgsql triggers
(`place_in_lineage`, `handle_new_version`, `swing_fks_to_new_version`) do lineage
placement and FK swinging on INSERT. That means the read path the app needs is
simple — "give me the current head" — and there is no application-side version
logic for reads.

Constraints discovered while planning:

- **Local PostgreSQL 16.14 is running** (`localhost:5432`); **no Docker** and no
  podman are installed. Solo developer.
- The reference resource maps to table **`refs`** (JSONB column `reference`), not
  `references`. Other maps: `authorities→(authorities, authority)`,
  `collections→(collections, collection)`, `schemas→(schemas, schema)`,
  `characters→(characters, character)`, `states→(states, state)`.
- **No `specimens` table exists** in `create_new.sql`.
- `pbdb2-migrations/pg-pool.js` already encodes the env contract
  (`PG_HOST/PORT/USER/PASSWORD/DATABASE`, `PG_CA_CERT`→SSL, `max: 5`).
- The legacy `play/server.js` recursive CTE assembles the schema tree but aliases
  `permid` as `pbotID`; this API uses `permid` as the public key.

## Goals / Non-Goals

**Goals:**

- A reusable PostgreSQL connection seam (`fastify.pg`) configured from `PG_*`.
- A generic, factory-style read repository parameterized by `(table,
  jsonbColumn)` that mirrors `crud-routes.js`, plus the `schemas` tree query.
- DB-backed GET (list + single) for `references`, `authorities`, `collections`,
  and `schemas`, with 404 on a miss.
- A two-tier test strategy: stubbed default tests + a real-Postgres integration
  tier provisioning an ephemeral database.

**Non-Goals:**

- Any write path (POST/PUT/PATCH/DELETE stay stubbed), request-body validation,
  Swagger, edit concurrency, soft-delete write semantics, pagination, the
  `/versions` sub-resource, and wiring `specimens` (no table yet).
- **Relationship enrichment.** By design, foreign keys are never stored in the
  JSONB; they live as columns on the enclosing table (`reference_id`,
  `early_age_id`/`late_age_id`, `reference_type_id`, the universal
  `enterer_person_id` / `authorizer_person_id`, plus the `additional_*_refs`
  many-to-many tables). Exposing those relationships — as `links` or as embedded
  data — is deferred. This change exposes only `permid` + payload. See the
  enrichment decision below for how the design stays open to it.

## Decisions

### Decision: `@fastify/postgres` over lifting `pg-pool.js`

Use `@fastify/postgres`, configured from the same `PG_*` env vars as the
migrations repo. It wraps the same `pg.Pool`, adds `fastify.pg.query`, a
`transact()` helper (useful when writes land later), and clean `onClose`
shutdown. **Alternative considered:** copy `pg-pool.js` and register it as a
bare plugin (no new dep) — defensible, but re-implements lifecycle/shutdown that
the official plugin already handles. The single small dependency is worth it.

### Decision: Runtime env loading + fail-fast in the server entry, tolerant `build()`

`.env` is loaded by the **server entry** (`import 'dotenv/config'` at the top of
`src/server.js`), not by `build()` or `config.js` — so the in-process test suite
stays env-agnostic. `dotenv` is therefore a runtime **dependency**, not just a
dev one. The connection config asymmetry that follows is deliberate:

- **`server.js` fails loudly**: if `PG_*` is missing it logs the missing vars and
  `process.exit(1)`. A real server with no database would otherwise silently
  serve stub data — a misconfiguration masquerading as a mode.
- **`build()` / the postgres plugin stay tolerant**: they skip with a warning
  when unconfigured (and accept an injected fake `pg`), because tests must run
  with no database and the route factory's stub fallback depends on it.

This was added after the initial route wiring, when DB-backed routes still
returned stubs: the running server never loaded `.env`, so `PG_*` was absent and
the plugin silently fell back. Loud failure at the entry prevents a recurrence.
**Alternative considered:** fail-fast inside `build()` — rejected because it
would break the database-free test suite.

### Decision: Generic read-repository factory mirroring `crud-routes.js`

A `makeReadRepository({ table, jsonbColumn })` returns `{ readHead(permid),
list() }`. Table/column identifiers come only from a **fixed internal map**
(never request input) and are emitted as quoted identifiers; the `permid` value
is always a bound parameter (`$1`). This keeps the four uniform resources on one
code path, exactly as the route factory does. **Alternative considered:** a
per-entity repository module each — more boilerplate, no benefit while reads are
uniform.

### Decision: `schemas` keeps a bespoke recursive-CTE module

The schema tree is assembled by the proven recursive CTE from
`play/server.js`, adapted to (a) expose `permid` instead of `pbotID` and (b)
filter every level on `succeeded_by_id IS NULL AND NOT COALESCE(removed, false)`.
It lives in its own module and is called from `schemas/index.js`, not forced
into the generic factory.

### Decision: Route wiring preserves the stub/DB seam

`crud-routes.js` gains an optional repository: when a route group passes a
repository, GET handlers read from it (single read 404s via
`@fastify/sensible`'s `notFound()` on an empty result); when it passes only a
`stub` (i.e. `specimens`), behavior is unchanged. Write handlers keep calling
`stub`. This isolates the change to the read path and keeps `specimens` working
without a table.

### Decision: Resource map is a descriptor, designed to grow into relationship enrichment

`src/lib/resource-tables.js` is framed as the per-entity **descriptor**, not just
a name→table lookup. Today it carries `(table, jsonbColumn)`. The factory is
shaped so enrichment slots in later as an **optional** third field —
`relationships`, e.g. `{ reference: { column: 'reference_id', target: 'refs' },
earlyAge: { column: 'early_age_id', target: 'intervals' }, ... }` — consumed by
one generic repository *engine*. Entities without `relationships` behave exactly
as in this change. **This means no per-entity repository modules**: the
non-uniformity between entities is declarative config, not bespoke code (the
same parameterization style as `crud-routes.js`). `schemas` remains the sole
hand-written exception.

Why this works cleanly: the head-select skeleton never changes, and the
`{ data, meta, links }` envelope already reserves `links` for relationships
(self, relationships, version history, pagination), so enrichment lands where it
was designed to. **Alternative considered:** per-entity repository modules now —
rejected as premature; reads are uniform and the FK differences are data, not
control flow.

A non-obvious constraint that shapes the future work: because FKs reference
**internal serial version-ids** and the API never exposes those, even the cheap
"emit links" option requires a JOIN from the FK column to the target row to fetch
its `permid` — the FK column alone cannot form a link. So enrichment is a
query-*shape* change (JOINs / sub-selects), not merely selecting extra columns.
See Open Questions for the version-pinning subtlety this raises.

### Decision: Ephemeral-database integration harness, no Docker

The integration suite connects via `PG_*` to the local server, `CREATE
DATABASE pbdb2_test_<random>`, loads `create_new.sql` (so real triggers/CTEs
run), seeds fixtures, runs assertions, then `DROP DATABASE`. It is a separate
`test:integration` script kept out of `npm test`. **Alternatives considered:**
Testcontainers (rejected — would force Docker as a team dependency for zero gain
over the running local instance; revisitable later behind the same `PG_*`
seam); pg-mem (rejected — cannot execute plpgsql triggers, so it would silently
skip the exact lineage/CTE behavior we must verify). Coupling the harness to
"a PG connection + an ephemeral DB" rather than to Testcontainers means adopting
Docker later requires no test rewrites.

## Risks / Trade-offs

- **Integration tests depend on a reachable PostgreSQL + a role that can `CREATE
  DATABASE`** → keep them out of the default `npm test`; document the `PG_*`
  setup in `.env.example`; skip with a clear message if the connection is
  absent rather than failing hard.
- **`create_new.sql` drifts from the API's assumptions** (table/column names,
  trigger behavior) → the integration tier loads the real file, so drift
  surfaces as a test failure rather than a production surprise.
- **`specimens` has no table** → explicitly left stubbed and called out in the
  spec; a single-read against it must not hit the DB.
- **List reads are unbounded** (no pagination yet) → acceptable for this change;
  the envelope already reserves `links.next`/`prev` for a later pagination
  change. Tables are small enough today.
- **`reference` table-name mismatch (`refs`)** → centralizing the
  resource→`(table, jsonbColumn)` map in one place makes this a single, tested
  point of truth rather than scattered string literals.

## Open Questions

These do not block this reads-only change but must be resolved before
relationship enrichment ships:

- **Link to lineage or pin to version?** A FK references a *specific version*
  (serial id) of the target, but a `permid` link resolves to the *current head*,
  which may be newer than the referenced version. Decide whether relationship
  links point to the lineage (`permid`, follows head) or pin to the exact
  referenced version (needs a version-addressable URL, ties into the deferred
  `/versions` sub-resource).
- **Links vs. embedding (or both)?** Whether enrichment emits `links.*` only,
  embeds resolved target data inline, or supports an opt-in (`?embed=`) — affects
  query cost and the `relationships` descriptor's shape.
- **`additional_*_refs` many-to-many.** The descriptor model must express the
  collection/schema secondary-refs join tables, which resolve via sub-select
  rather than a single FK column.
