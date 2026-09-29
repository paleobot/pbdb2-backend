## 1. Baseline

- [x] 1.1 Record the base commit (`git rev-parse HEAD`). Build a scratch database from `postgresql/create_new.sql` at that commit (`createdb`, then `psql -v ON_ERROR_STOP=1 -f`), and save `pg_dump --schema-only` and `pg_dump --data-only --schema=dictionaries` of it to the scratchpad (D6)
- [x] 1.2 Confirm nothing in flight edits the DDL: `git diff main...origin/graph-visuals -- postgresql/` is empty, and no `postgres-exploration` sync is pending (ask before continuing if unsure)

## 2. Split the file

- [x] 2.1 Create `postgresql/01-dictionaries.sql`: `CREATE SCHEMA dictionaries` first, then every `dictionaries.*` table and seed in their current order, the taxonomy dictionaries and their design headers included (D1)
- [x] 2.2 Create `postgresql/02-core.sql`: `CREATE EXTENSION IF NOT EXISTS postgis` and `CREATE SCHEMA lookup`, the versioning trigger functions, `persons` through `authorities`, the three opinion ledgers, `taxon_annotations`, `homonyms` and the LAYER 1 ledger indexes, in their current relative order (D1)
- [x] 2.3 Create `postgresql/03-taxa.sql`: `CREATE EXTENSION IF NOT EXISTS ltree`, then `taxa_linnaean` and its indexes, `cycle_cuts`, and the rest of the derivation section through `rebuild_taxa_full()`, in their current relative order (D1)
- [x] 2.4 Check that every statement of `create_new.sql` appears in exactly one new file: compare the sorted non-comment, non-blank lines of `create_new.sql` with those of the three files concatenated. The only differences allowed are in `--` comment lines
- [x] 2.5 Split the comment headers: the TAXA & OPINIONS preamble and LAYER 1 header's ledger content (the identity inversion, append-only versioning without `install_version_triggers`, name-as-spelled pointers without FKs, minting) go to `02-core.sql`. The derivation narrative goes to `03-taxa.sql`. Give each file a short header saying what it holds, its place in the load order, and a pointer to `docs/classic-taxa-opinions.md` §9.5. Reword cross-references like "defined later in this section" or "elsewhere in this file" to name the file. Text inside function bodies does not change (D6)
- [x] 2.6 `git rm postgresql/create_new.sql`

## 3. Runner

- [x] 3.1 `src/run-migrations.js` `applyCreateDb()`: read `postgresql/[0-9][0-9]-*.sql` in sorted order (`readdirSync` + filter + sort), fail with a `CheckFailure` naming the directory if none match, join the contents with `\n`, and run that as the one query. Log the file names applied. Error handling unchanged (D4)
- [x] 3.2 Update the `--createdb` section comment (the "has no psql meta-commands…" block) and the comments at the dictionary-seeds note (~L218) and the connectivity preflight (~L415) to refer to the DDL files rather than `create_new.sql`

## 4. Guard test

- [x] 4.1 Add `postgresql/tests/ddl-layout.test.js`: assert the `NN-*.sql` files are exactly the three. Collect each file's defined names (`CREATE TABLE`, `CREATE [OR REPLACE] FUNCTION`, `CREATE SCHEMA`, `CREATE EXTENSION`, keeping schema qualification). Strip `--` comments (but not string literals or function bodies) and report every whole-word match of a later file's name as `file:line: name (defined in later-file)` (D5)
- [x] 4.2 Add `"postgresql/tests/*.test.js"` to the `test` script in `package.json`
- [x] 4.3 Prove the guard catches violations. Temporarily add a `PERFORM rebuild_taxa_full();` in a core function body, a `taxa_linnaean` FK in a core table, and a fourth file `04-x.sql`; confirm each is reported, then revert. Confirm that a `--` comment in core mentioning `taxa_linnaean` and an identifier like `taxa_count` do not trip it

## 5. Specs and docs

- [x] 5.1 Reword the `create_new.sql` mentions in the main specs `entity-versioning-triggers`, `permid-uuidv7`, `taxa-opinions`, `taxa-unified`, `payload-schemas-boundary` and `payload-schema-enums`. "Applying `create_new.sql`" becomes "applying the DDL". Where a requirement locates an object, it names the specific file (for example, `payload-schema-enums` → `postgresql/01-dictionaries.sql`). Each edit changes only the file reference (D7). Leave `migration-runner` to its delta
- [x] 5.2 `payloadSchemas/tests/dictionary-seeds.test.js` header comment: `postgresql/01-dictionaries.sql`
- [x] 5.3 `docs/monorepo-plan.md`: the layout tree, the path table row, the dependency diagram, the move step, the API-test note and the "What you'll need to do" `psql -f` example now describe `db/01-dictionaries.sql`, `db/02-core.sql` and `db/03-taxa.sql` (or `db/*.sql`). `docs/api-design-backlog.md`: the same in the "Repository boundary" diagram and order of work
- [x] 5.4 `docs/taxa-opinions-migration-mapping.md` "Target schema" pointer (~L32): point to `02-core.sql` (ledgers) and `03-taxa.sql` (derivation), dropping the stale line offsets. Leave historical mentions in `docs/classic-taxa-opinions.md`, archived changes and `migration_exploration/` as written
- [x] 5.5 Search for `create_new` outside `openspec/changes/archive/`, `node_modules/`, `migration_exploration/` and `docs/classic-taxa-opinions.md`. Each remaining hit is either fixed or a deliberate historical mention. Point out `.claude/settings.local.json`'s `psql -f postgresql/create_new.sql` entries to the user rather than editing them

## 6. Verification

- [x] 6.1 `npm test` passes, including the new guard
- [x] 6.2 Build a scratch database from the three files in order (`cat postgresql/0*.sql | psql -v ON_ERROR_STOP=1`). Its `pg_dump --schema-only` and dictionaries `--data-only` dumps are byte-identical to the baseline from 1.1 (D6)
- [x] 6.3 Build a scratch database from `01-dictionaries.sql` and `02-core.sql` alone: both apply cleanly (ddl-layout "Core stands without taxa")
- [x] 6.4 Full migration run with `--createdb` against a freshly created empty database: every step passes and the totals match the last good run in `src/run-migrations.log`. Also confirm `--createdb` against the populated result still refuses with the "initializes an EMPTY database" message
- [x] 6.5 Drop the scratch databases. `openspec validate split-create-new-sql` and `openspec validate --all` pass

## 7. pbdb2-api companion (cross-repo)

- [x] 7.1 `pbdb2-api/test/integration/helpers.js`: load `[0-9][0-9]-*.sql` from `DDL_DIR` (default `../../../pbdb2-migrations/postgresql`) in sorted order, concatenated, as one query. Replace `CREATE_SQL_PATH` and its "not found" message; update the comments that name `create_new.sql`
- [x] 7.2 `pbdb2-api/.env.example` (the override) and `openspec/specs/data-access/spec.md` (the harness requirement's schema wording)
- [x] 7.3 `npm test` and `npm run test:integration` in `pbdb2-api` pass, with the integration suite actually running (not skipped) against the split files. Running them exposed pre-existing fixture drift from 694ff6c (2026-09-22), fixed in the same companion commit: `seedPerson()` queried `dictionaries.roles.role` (now `name`) and omitted the now-`NOT NULL` `persons.permid` (minted with `newPermid()`). Result: 89/89 unit, 27/27 integration
