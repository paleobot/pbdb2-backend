## 1. Mapping documents

- [x] 1.1 `git mv` the five files in `payloadSchemas/mappings/` to their migrations' `docs/` subdirectories, names unchanged: `opinions.md` → `src/opinions-migration/docs/`, `specimens.md` → `src/specimens-migration/docs/`, `authorities-opinions.md` → `src/authority-opinions-migration/docs/`, `collections.txt` and `collections-pbot.txt` → `src/collections-migration/docs/`. Remove the empty `payloadSchemas/mappings/` (D1)
- [x] 1.2 Update the references to the new paths: the header comments of `src/opinions-migration/migrate-opinions.js` and `src/specimens-migration/migrate-specimens.js`; `docs/taxa-opinions-migration-mapping.md`; `migration_exploration/DESIGN.md`; the relative link in `migration_exploration/opinions-pair-mapping.md` (check that it resolves)
- [x] 1.3 Search for `payloadSchemas/mappings` and `mappings/` outside `openspec/changes/` (and `node_modules/`), including `.claude/settings.local.json`, `README.md` and `src/README.txt`: no remaining references to the old location

## 2. Test database helper

- [x] 2.1 Add `payloadSchemas/tests/pg.js`: loads `dotenv/config`; `getPg()` checks `PG_HOST`, `PG_USER`, `PG_PASSWORD` and `PG_DATABASE` on first call and throws an error naming the missing ones, otherwise lazily builds a `Pool` with the same options as `src/lib/pg-pool.js` (port default 5432, `max: 5`, `PG_CA_CERT` → `ssl.ca`) and returns the same pool on later calls; `closePg()` ends the pool if one exists and is a no-op otherwise. No `process.exit` (D3)
- [x] 2.2 `payloadSchemas/tests/enums.test.js`: import from `./pg.js`, call `getPg()` inside the two "(real DB)" test bodies, and close with `after(() => closePg())`
- [x] 2.3 `payloadSchemas/tests/dictionary-seeds.test.js`: the same, with `getPg()` inside each generated test. Update its header comment's `postgresql/create_new.sql` wording only if needed (the path is unchanged)

## 3. Boundary guard

- [x] 3.1 Add `payloadSchemas/tests/boundary.test.js`: walk every `.js` file under `payloadSchemas/`; extract `from '…'`, `import '…'`, `import('…')` string-literal specifiers and `new URL('…', import.meta.url)` paths, ignoring comment lines; resolve relative ones against the file and fail with a list of `file: specifier` for each that resolves outside `payloadSchemas/`. Bare and `node:` specifiers pass (D4)
- [x] 3.2 Prove the guard catches violations: temporarily reintroduce `import { pg } from '../../src/lib/pg-pool.js'` in a test file and a `new URL('../../src/…', import.meta.url)` read, confirm both are reported by name, then revert. Also confirm a `*.schema.js` header comment mentioning `src/authorities-migration` does not trip it

## 4. Docs

- [x] 4.1 `docs/api-design-backlog.md`, "Repository boundary", order of work, step 1: describe the split as it is. `lib/` and the sources are already self-contained; the work is moving the mapping docs, a tests-local pg helper that fails without exiting, and a guard test. The seed-fidelity test stays. Name this change. Fix the `payloadSchemas' mappings/*.md` leaf entry in the layout diagram to "mapping docs (in each migration's `docs/`)"
- [x] 4.2 `docs/monorepo-plan.md`: the path table row for `payloadSchemas/mappings/*.md` (now already under `src/*-migration/docs/`, so it moves with `src/`), and step 1 of "How we get there": say it is small, name this change, drop "the only step that changes code rather than moving it", and mention that the guard test enforces the rule
- [x] 4.3 Add the frozen seed-fidelity requirement to `docs/api-design-backlog.md` as an open API item: once dictionaries are editable, "seeds equal the legacy snapshot" must loosen, e.g. to "seeds include every value present in migrated data"

## 5. Verification

- [x] 5.1 `npm test` with the `.env` pointing at localhost `pbdb`: every suite passes, including the new guard, `enums.test.js` and `dictionary-seeds.test.js`
- [x] 5.2 From a directory with no `.env` and the `PG_*` variables unset, run `node --test payloadSchemas/tests/*.test.js` (absolute paths): the pure tests in `enums.test.js` pass, its two DB tests fail with the message naming the missing variables, every `dictionary-seeds.test.js` test fails the same way, none is skipped, and the guard and other suites pass
- [x] 5.3 `git diff --stat` and `git diff src/`: the only changes under `src/` are the renames into `docs/` and comment lines in `migrate-opinions.js` and `migrate-specimens.js`. No executable line changed, so no migration run is needed
- [x] 5.4 `openspec validate split-payload-schemas` passes
