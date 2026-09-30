## 1. Prepare and record baselines

- [ ] 1.1 Install `git-filter-repo` (Ubuntu package) and confirm `git filter-repo --version` works
- [x] 1.2 Commit this change's artifacts and the pending `docs/monorepo-plan.md` edits on `ddm-dev`; fast-forward `main`, push both; confirm both repos have clean working trees and `pbdb2-api` has only `main`, pushed
- [ ] 1.3 Tag the resulting commit `pre-monorepo` (local tag; the rollback target)
- [ ] 1.4 Record baselines on `pre-monorepo`: root `npm test` pass/fail counts; `pbdb2-api` `npm test` (89) and `npm run test:integration` (27) counts
- [ ] 1.5 Record the migration baseline: create an empty scratch database, run `node src/run-migrations.js --createdb` with `PG_DATABASE` overridden to it, save the per-step row totals from the run log, then drop the database

## 2. Move files (one pure-rename commit)

- [ ] 2.1 `git mv` `postgresql/01-dictionaries.sql`, `02-core.sql`, `03-taxa.sql` and `postgresql/tests/` into `db/`
- [ ] 2.2 `git mv` `src/`, `mariadb/` and `migration_exploration/` into `migrations/`, and `package.json` to `migrations/package.json`
- [ ] 2.3 Confirm nothing untracked or ignored is left in the old directories (none expected; the stale `anomalies.csv` files were deleted); move local run artifacts under `src/` (logs, `anomalies.csv`, `run-summary.txt`) to their new places
- [ ] 2.4 Commit with a message saying the tree doesn't pass `npm test` until the fix commits; verify `git show --stat -M HEAD` lists only 100% renames

## 3. Graft the API history

- [ ] 3.1 In a scratch directory, make a fresh clone of `pbdb2-api` and run `git filter-repo --to-subdirectory-filter api`; confirm 16 commits, every path under `api/`
- [ ] 3.2 Fetch that clone into the backend repo and merge it with `--allow-unrelated-histories` as its own commit; confirm `git log --follow api/src/app.js` reaches the API's first commit
- [ ] 3.3 Confirm the `../pbdb2-api` checkout and the GitHub repo are untouched

## 4. One root `.env` and certificate (D1)

- [ ] 4.1 `migrations/src/lib/pg-pool.js` and `mariadb-pool.js`: load the root `.env` by path from the module's location; resolve a relative `PG_CA_CERT` against the repo root
- [ ] 4.2 `migrations/src/run-migrations.js` and the two opinions test runners (`run-migration.js`, `run-reference-handlers.js`) and `cross-check-reference.js`: load the root `.env` by path; keep `REPO_ROOT` meaning the migrations root and add a separate constant for the backend root
- [ ] 4.3 `payloadSchemas/tests/pg.js`: load the root `.env` by path and resolve a relative `PG_CA_CERT` against the root; update `payloadSchemas/tests/boundary.test.js` to allow exactly that one read
- [ ] 4.4 API: `api/src/server.js`, `api/src/config.js` / `api/src/plugins/postgres.js` and `api/test/integration/helpers.js` load the root `.env` by path and resolve a relative `PG_CA_CERT` against the root; fix the stale "mirroring pbdb2-migrations/pg-pool.js" comment
- [ ] 4.5 Write a root `.env.example` covering every variable read by `migrations/`, `payloadSchemas/` and `api/` (from the API's `.env.example` plus the migrations' variables); delete `api/.env.example`
- [ ] 4.6 Local only: confirm the root `.env` holds everything the API's `.env` held (identical `PG_*`), and that no `api/.env` or `migrations/.env` exists

## 5. Paths across areas (D8)

- [ ] 5.1 `migrations/src/run-migrations.js`: `--createdb` reads `db/` at the backend root, located from the file's own location
- [ ] 5.2 `api/test/integration/helpers.js`: `DEFAULT_DDL_DIR` points at `db/` in the same repo; `DDL_DIR` still overrides; the "not found" message still names the directory
- [ ] 5.3 `db/tests/ddl-layout.test.js`: read the DDL from `db/`
- [ ] 5.4 Fix every other import or path that pointed at an old location: grep `migrations/src/`, `payloadSchemas/` and `db/` for `postgresql/`, `../payloadSchemas`, `../src/` and relative `join(…, '..')` walks, and correct each (`migration_exploration/` is not fixed up)
- [ ] 5.5 `.gitignore`: prefix the `src/` and `migration_exploration/` entries with `migrations/`; keep `api/.gitignore` as is

## 6. Workspaces (D4)

- [ ] 6.1 New root `package.json`: `private`, `"workspaces": ["migrations", "api"]`, dependencies `ajv`, `dotenv`, `pg`; `test` runs `node --test` over `payloadSchemas/tests/`, `db/tests/` and `tests/`, then `npm test -w migrations` and `npm test -w api`; `test:integration` runs `npm run test:integration -w api`
- [ ] 6.2 `migrations/package.json`: rename it off the root's name if they clash; its `test` script runs only `src/tests/`
- [ ] 6.3 Delete `api/package-lock.json`; `rm -rf node_modules api/node_modules` then `npm install` at the root; confirm one `package-lock.json`, at the root

## 7. Repository guard (D5)

- [ ] 7.1 Write `tests/repository-layout.test.js` per `repository-layout`, reusing the scanning approach of `payloadSchemas/tests/boundary.test.js`
- [ ] 7.2 Prove it: add a temporary import of `../../migrations/src/lib/uuidv7.js` in an `api/test/` file, confirm the guard fails naming it, remove it, confirm it passes

## 8. OpenSpec and docs (D7)

- [ ] 8.1 Move `api/openspec/specs/*` to `openspec/specs/` and `api/openspec/changes/archive/*` to `openspec/changes/archive/`; delete `api/openspec/`; confirm no names collided
- [ ] 8.2 Rewrite `openspec/config.yaml`'s project context for the whole backend (DDL, payload schemas, API, migrations, the dependency rule and the spec-path convention); remove the migration-only per-artifact rules that don't apply to the other areas
- [ ] 8.3 Delete `api/.claude/` and `api/.github/` OpenSpec skill and command copies; run `openspec update` at the root; commit the regenerated files
- [ ] 8.4 Update `api/CLAUDE.md` ("separate repos" wording, layout, commands run from the root), the root `README.md`, and the "After the move" section of `docs/monorepo-plan.md` (one root `.env` from `.env.example`; delete any old `api/.env`); set the plan's status line to "moved"
- [ ] 8.5 `openspec validate --all --strict` passes

## 9. Checks

- [ ] 9.1 Root `npm test` passes, with counts matching the 1.4 baselines plus the new guard test
- [ ] 9.2 `npm run test:integration` at the root reports 27 tests run and 27 passed (not skipped)
- [ ] 9.3 Run the API tests from `api/` with `npm test -w api` and the runner from `migrations/`, and confirm both find the root `.env`
- [ ] 9.4 Full migration run into a fresh scratch database (as in 1.5), started from `migrations/`; per-step totals identical to the 1.5 baseline; drop the database
- [ ] 9.5 `git log --follow` works across the move for a sample of files: `db/02-core.sql`, `migrations/src/run-migrations.js`, `payloadSchemas/lib/variants.js`, `api/src/app.js`

## 10. Stop for the user's review

- [ ] 10.1 STOP. Everything is committed locally and nothing is pushed. Summarize the commits, the check results and anything unexpected, and wait for the user's explicit go-ahead before group 11

## 11. Publish (only after the go-ahead)

- [ ] 11.1 Push `ddm-dev`, fast-forward `main`, push `main`
- [ ] 11.2 Rename `pbdb2-migrations` to `pbdb2-backend` on GitHub; `git remote set-url origin git@github.com:paleobot/pbdb2-backend.git`
- [ ] 11.3 Add a README pointer in `pbdb2-api` to `pbdb2-backend/api/`, push it, then archive `pbdb2-api` on GitHub
- [ ] 11.4 If the local folder is renamed to `pbdb2-backend`, copy Claude Code's project memory folder to the new path's key
