## 1. Delete the dead consumers and root pg-pool.js

- [x] 1.1 `git rm -r play/` (`server.js`, `schema-query-design.md`) and `git rm pg-pool.js`
- [x] 1.2 `git rm src/opinions-migration/tests/cross-check-aurora.js`, delete its ignored `cross-check-report.txt`, and remove the `src/opinions-migration/tests/cross-check-report.txt` line from `.gitignore` (keep the `cross-check-reference-report.txt` line)
- [x] 1.3 Confirm nothing outside `migration_exploration/` and `openspec/changes/archive/` still imports root `pg-pool.js`, `play/`, `cross-check-aurora.js`, or any root `pg-*-pool.js`

## 2. Move the specialty pools into migration_exploration/testing/

- [x] 2.1 `git mv` `pg-classic-pool.js`, `pg-play-pool.js`, and `pg-migrated-pool.js` into `migration_exploration/testing/`
- [x] 2.2 In the 25 scripts under `migration_exploration/testing/`, rewrite `'../../pg-classic-pool.js'`, `'../../pg-play-pool.js'`, and `'../../pg-migrated-pool.js'` to `'./pg-…-pool.js'`
- [x] 2.3 Verify: no `../../pg-` specifier remains in `migration_exploration/testing/`, and every `./pg-*-pool.js` specifier there names a file that exists in that folder
- [x] 2.4 Verify the repository root contains no `.js` files

## 3. Specs and docs

- [x] 3.1 Update the Purpose (done during apply; syncing deltas leaves Purpose untouched) of `openspec/specs/db-connection-config/spec.md`: the module list becomes `src/lib/pg-pool.js`, `src/lib/mariadb-pool.js`, `src/lib/db.js` (drop `pg-classic-pool.js`)
- [x] 3.2 `docs/monorepo-plan.md`: remove `play/` and `pg-*.js` from the layout tree and the path table; in the "Why" diagram, replace the `play/server.js → schema-tree.js` row and point the `pg-pool.js → config.js` row at `src/lib/pg-pool.js`
- [x] 3.3 `docs/api-design-backlog.md`: remove `play/` and `pg-*.js` from the `migrations/` leaf listing
- [x] 3.4 `openspec validate clear-root-pools --strict` passes

## 4. Check nothing live changed

- [x] 4.1 `npm test` passes with the same count as before the change (122/122 with a database)
- [x] 4.2 `node --input-type=module -e "await import('./src/run-migrations.js')"` loads without module-not-found errors (the runner only runs when invoked directly, so importing it executes nothing)
