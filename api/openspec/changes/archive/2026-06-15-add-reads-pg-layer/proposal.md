## Why

Every resource handler currently returns canned stub data; the API does not yet
talk to the PostgreSQL backend described in `pbdb2-dev` / `pbdb2-migrations`.
Wiring up **reads first** proves the full pipeline (connection → repository →
envelope) against real, version-chained data while side-stepping the harder
write-path questions (validation, edit concurrency, soft-delete semantics) that
can be deferred. Reads-only is low-risk and immediately useful: GET endpoints
start returning real records.

## What Changes

- Add a PostgreSQL connection as a Fastify plugin via `@fastify/postgres`,
  configured from `PG_*` environment variables (mirroring
  `pbdb2-migrations/pg-pool.js`: `PG_HOST/PORT/USER/PASSWORD/DATABASE`, optional
  `PG_CA_CERT` for SSL, pool `max: 5`). Update `.env.example`.
- Add a **generic read repository** parameterized by `(table, jsonbColumn)`,
  mirroring the `crud-routes.js` factory. It provides head-read
  (`WHERE permid = $1 AND succeeded_by_id IS NULL AND NOT COALESCE(removed, false)`)
  and list operations.
- Keep `schemas` as the exception: its single read assembles the
  `schema → characters → states` tree via the recursive CTE already proven in
  `pbdb2-migrations/play/server.js`, returning `permid` (never the legacy
  `pbotID`).
- Swap the **GET** handlers (list + single read) for `references`,
  `authorities`, `collections`, and `schemas` from stubs to real DB-backed data.
  A miss on single-read returns 404. Write verbs (POST/PUT/PATCH/DELETE) keep
  their current stub behavior, unchanged.
- Add a **two-tier test strategy**: route/unit tests keep running against a
  stubbed data layer in the default `npm test` (no DB); a new `test:integration`
  script runs against the **local PostgreSQL** instance, creating an ephemeral
  `pbdb2_test_<random>` database per run, loading `create_new.sql`, seeding
  fixtures, and verifying head selection and the schema-tree assembly. No Docker
  / Testcontainers for now (none installed; revisitable later behind the same
  `PG_*` env seam).

## Capabilities

### New Capabilities
- `data-access`: The PostgreSQL connection plugin, the generic read-repository
  abstraction (head-read + list, parameterized by table/JSONB column), the
  `schemas` recursive-CTE tree read, and the integration-test harness that
  provisions an ephemeral database against a real Postgres.

### Modified Capabilities
- `resource-routes`: GET (list + single read) for `references`, `authorities`,
  `collections`, and `schemas` now return data persisted in PostgreSQL instead
  of stubs, with 404 on a single-read miss. Write verbs and the `specimens` read
  remain stubbed (see Impact).

## Impact

- **Code:** new `src/plugins/postgres.js` (or equivalent decorator), new
  `src/lib/repository.js` (generic read repo) + a `schemas` tree query module;
  edits to the four uniform route modules and `schemas/index.js` to read via the
  repository; `crud-routes.js` gains a DB-backed read path while preserving the
  stub write path.
- **Dependencies:** add `@fastify/postgres` (wraps `pg`). A dev/test dependency
  may be needed to load env in the integration harness (`dotenv`), matching the
  migrations repo.
- **Config:** `.env.example` gains the `PG_*` variables; `package.json` gains a
  `test:integration` script.
- **Open gap — `specimens`:** there is **no `specimens` table** in
  `create_new.sql`. The route stays stubbed in this change; wiring it is
  deferred until the table exists. This is called out so the omission is
  intentional, not an oversight.
- **Not in scope (deferred):** all write paths, request-body validation /
  Swagger from JSON Schemas, edit concurrency strategy, soft-delete semantics,
  pagination, and the `/versions` sub-resource.
