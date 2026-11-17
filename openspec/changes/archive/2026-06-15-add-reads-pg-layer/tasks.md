## 1. Connection plugin & config

- [x] 1.1 Add `@fastify/postgres` to `dependencies` and `dotenv` to `devDependencies` in `package.json`
- [x] 1.2 Add `src/plugins/postgres.js`: register `@fastify/postgres` from `PG_HOST/PORT/USER/PASSWORD/DATABASE`, optional `PG_CA_CERT`→SSL, pool `max: 5`; wrap with `fastify-plugin` so `fastify.pg` is global; rely on the plugin's `onClose` for shutdown
- [x] 1.3 Surface `PG_*` config in `src/config.js` (and fail-fast / clear message when required vars are missing, matching `pbdb2-migrations/pg-pool.js`)
- [x] 1.4 Add the `PG_*` variables (with comments) to `.env.example`
- [x] 1.5 Add a `test:integration` script to `package.json` (e.g. `node --test test/integration/`)

## 2. Read repository

- [x] 2.1 Add `src/lib/resource-tables.js`: the per-entity **descriptor** map (single point of truth for identifiers) — `references→{table: refs, jsonbColumn: reference}`, `authorities→{authorities, authority}`, `collections→{collections, collection}`, `schemas→{schemas, schema}`. Shape it so an optional `relationships` field can be added later without restructuring (relationship enrichment is deferred — see design.md)
- [x] 2.2 Add `src/lib/repository.js`: `makeReadRepository({ pg, table, jsonbColumn })` returning `{ readHead(permid), list() }`; identifiers come only from the map and are quoted, `permid` is always bound `$1`; head filter is `succeeded_by_id IS NULL AND NOT COALESCE(removed, false)`; select exposes `permid` + payload only (no serial ids / chain columns)
- [x] 2.3 Add `src/lib/schema-tree.js`: the recursive-CTE schema→characters→states query adapted from `pbdb2-migrations/play/server.js` — expose `permid` (not `pbotID`), filter every level on `succeeded_by_id IS NULL AND NOT COALESCE(removed, false)`, return assembled tree or null

## 3. Route wiring

- [x] 3.1 Extend `src/lib/crud-routes.js`: accept an optional `repository`; when present, GET list reads `repository.list()` and GET single reads `repository.readHead(permid)`, returning `404` (via `@fastify/sensible` `notFound()`) on no result; write verbs keep using `stub`; when absent, behavior is unchanged
- [x] 3.2 Update `references`, `authorities`, `collections` route modules to build a repository from `fastify.pg` + the table map and pass it to `registerCrudRoutes`
- [x] 3.3 Leave `specimens/index.js` on the stub path (no table) — confirm its GETs do not touch the DB
- [x] 3.4 Update `schemas/index.js`: GET single calls `schema-tree.js` (404 on null); GET list reads heads via the repository; write verbs unchanged

## 4. Tests — default tier (no DB)

- [x] 4.1 Ensure existing route tests still pass against the stub/repository seam (inject a fake repository where needed) so `npm test` requires no database
- [x] 4.2 Add a route test asserting a single-read miss returns 404 in the standard error shape

## 5. Tests — integration tier (real PostgreSQL)

- [x] 5.1 Add `test/integration/helpers.js`: connect via `PG_*`, `CREATE DATABASE pbdb2_test_<random>`, load `create_new.sql`, expose seed + teardown (`DROP DATABASE`); skip with a clear message if no connection is available
- [x] 5.2 Add integration test: seed a `refs` lineage, assert `readHead` returns the head and excludes a superseded/removed version
- [x] 5.3 Add integration test: seed a schema with nested characters/states and assert `schema-tree.js` assembles the tree from current versions only, keyed by `permid`
- [x] 5.4 Add integration test: assert a `list()` returns one record per non-removed lineage head

## 6. Verify & document

- [x] 6.1 Run `npm test` (passes with no DB) and `npm run test:integration` against the local Postgres (passes)
- [x] 6.2 Confirm responses expose only `permid` + payload (no internal ids / chain columns) and the `{ data, meta, links }` envelope is intact
- [x] 6.3 Note in the change/PR that `specimens` and all write paths remain stubbed and deferred

## 7. Runtime env loading & fail-fast

- [x] 7.1 Load `.env` at the server entry: `import 'dotenv/config'` at the top of `src/server.js`; promote `dotenv` from devDependencies to runtime `dependencies`
- [x] 7.2 Fail loudly in `src/server.js` when `PG_*` is missing (`config.pg.configured` false) — log the missing vars and `process.exit(1)`; keep `build()` / the postgres plugin tolerant so the test suite runs DB-free
- [x] 7.3 Add a local git-ignored `.env` with the local `PG_*` (database `pbdb`); verify `npm start` serves real data, missing-`PG_*` startup exits 1, and `npm test` stays 20/20
