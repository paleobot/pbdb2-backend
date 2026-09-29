## Why

Four PostgreSQL pool modules still sit at the repository root, and none of them serves anything live.
Root `pg-pool.js` exists only for `play/server.js`, a demo API that pbdb2-api has superseded.
`pg-migrated-pool.js` serves `src/opinions-migration/tests/cross-check-aurora.js`, a one-off check
against the stale Aurora `pbdb2_migration_test` database, and two scripts in the superseded
`migration_exploration/testing/`. `pg-classic-pool.js` and `pg-play-pool.js` serve only
`migration_exploration/testing/`. The `db-connection-config` spec still requires the root pools, including
a scenario telling contributors not to delete `pg-pool.js`. Clearing them now also leaves the planned
monorepo move fewer root files to relocate.

## What Changes

- Delete `play/` (`server.js`, `schema-query-design.md`) and root `pg-pool.js`, its only consumer.
  `src/lib/pg-pool.js`, which the migrations use, is unaffected.
- Delete `src/opinions-migration/tests/cross-check-aurora.js`, its ignored report
  `cross-check-report.txt`, and that report's `.gitignore` line.
- Move `pg-classic-pool.js`, `pg-play-pool.js` and `pg-migrated-pool.js` into
  `migration_exploration/testing/`, the only place that uses them. Rewrite the 25 scripts' imports there
  from `'../../pg-*-pool.js'` to `'./pg-*-pool.js'`, so that Andrew's scripts keep working.
- Afterwards, the repository root contains no `.js` files.
- **`db-connection-config`:** `src/lib/` becomes the only connection-module set. The root-pools table and
  the "retained root pool" scenario go. The Postgres-ported Classic requirement and the `PG_CLASSIC_*`
  rows in the `.env` schema are removed, because the pools that read them now belong to
  `migration_exploration/`, which the specs don't describe.
- **`payload-schemas-boundary`:** the example list of forbidden import targets no longer names `play/` or
  the root `pg-*.js` modules. The rule itself is unchanged.
- Update the docs that list `play/` and `pg-*.js` in the planned layout: `docs/monorepo-plan.md` and
  `docs/api-design-backlog.md`.

No database, table or migrated data is touched. The change affects files and specs only.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `db-connection-config`: The "Shared connection module" requirement no longer provides root-level pools.
  The "Postgres-ported Classic connection module" requirement is removed. The `.env` variable schema drops
  `PG_CLASSIC_*`.
- `payload-schemas-boundary`: The wording of "`payloadSchemas/` depends on nothing outside itself" no longer
  names `play/` or the root pools.

## Impact

- **Deleted:** `play/server.js`, `play/schema-query-design.md`, `pg-pool.js`,
  `src/opinions-migration/tests/cross-check-aurora.js`.
- **Moved:** `pg-classic-pool.js`, `pg-play-pool.js`, `pg-migrated-pool.js` → `migration_exploration/testing/`.
- **Edited:** the imports of 25 scripts in `migration_exploration/testing/`, `.gitignore`,
  `docs/monorepo-plan.md`, `docs/api-design-backlog.md`, and two main specs, including the Purpose line of
  `db-connection-config`.
- **Contributors:** the `PG_CLASSIC_*`, `PG_PLAY_*` and `PG_MIGRATED_*` variables in a local `.env` keep
  working unchanged. The pools still load `.env` from the working directory, so the scripts still run from
  the repo root. Andrew is unreachable at the moment, so the change is planned so that his scripts don't
  break.
- **Not affected:** the migration runner, `npm test`, `src/lib/`, and pbdb2-api.
