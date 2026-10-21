## 1. Move the step script

- [x] 1.1 Move `migrations/src/taxa-rebuild/rebuild-taxa.js` to `migrations/src/rebuild-taxa.js` (fix its `./lib/pg-pool.js` import) and remove the empty `taxa-rebuild/` directory
- [x] 1.2 Point the `taxa` step's `script` in `migrations/src/run-migrations.js` at `src/rebuild-taxa.js`
- [x] 1.3 Update the `taxa` row in `migrations/src/README.txt` to the new path

## 2. Check the code against the specs

- [x] 2.1 Confirm the `taxa` entry in `STEPS` matches the migration-runner delta: position 11, `env: ['PG']`, no inputs, writes and first-writer of `taxa_linnaean`, `taxa_clades`, `taxa_attachments`, `taxa`, preconditions `taxa` empty and the three opinion tables non-empty
- [x] 2.2 Update the runner's header comment counts if they contradict the "six of the eleven call `main()` unconditionally" statement

## 3. Verify

- [x] 3.1 `node src/run-migrations.js --list` ends in `taxa`; `node src/run-migrations.js --only taxon` exits non-zero listing the valid step names
- [x] 3.2 `node src/run-migrations.js --only taxa` against localhost `pbdb` (taxa already populated) fails preflight on `taxa` not being empty and spawns nothing
- [x] 3.3 `npm test` in `migrations/` passes
- [x] 3.4 `openspec validate add-taxa-rebuild-runner-step` passes

## 4. Archive follow-up

- [x] 4.1 After syncing specs, hand-edit the `## Purpose` of `openspec/specs/migration-runner/spec.md` ("the ten migrations") to mention the `taxa` step, since delta specs cannot modify a Purpose section
