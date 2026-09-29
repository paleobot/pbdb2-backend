## Why

`postgresql/create_new.sql` is one 8,827-line file holding three different things: the dictionary tables
and their seed data (about 4,600 lines, mostly `admin0`/`admin1` rows), the tables the API will write
(about 450 lines), and the derived taxa tables with the functions that build them (about 3,800 lines). They
change for different reasons and at different rates, and in one file every edit to one of them is a
potential merge conflict with the others. The core tables, the part the API will be built against, are
hard to find among the other 8,000 lines. Splitting the file now, in the current layout, also makes the
later monorepo move (`docs/monorepo-plan.md`) relocate three files instead of one.

## What Changes

- **`create_new.sql` becomes three files, split by function**, applied in this order:
  - `postgresql/01-dictionaries.sql`: the `dictionaries` schema and every `dictionaries.*` table with its
    seeds, including the taxonomy dictionaries (`taxonomy_ranks`, `namechange_reasons`,
    `nomenclatural_statuses`).
  - `postgresql/02-core.sql`: the tables the API writes, with their indexes. These are the versioning
    trigger functions, the `lookup` schema, `persons` through `authorities`, the three opinion ledgers
    (`name_opinions`, `assignment_opinions`, `validity_opinions`), `taxon_annotations` and `homonyms`.
  - `postgresql/03-taxa.sql`: what `rebuild_*()` writes and the functions that write it. These are
    `taxa_linnaean`, `taxa_clades`, `taxa_attachments`, `taxa` and `cycle_cuts`, with their indexes, and
    every `derive_*`, `rebuild_*` and `assert_*_invariant` function, including `rebuild_taxa_full()`.
- **Dependencies run one way.** Each file may refer to objects in the files before it, never in a file after
  it. Core names nothing in taxa, so the tables the API writes stand on their own. A trigger that fires on
  a core table but runs a taxa function (the planned ledger trigger, B2) is defined in `03-taxa.sql`.
- **A guard test in `npm test` enforces the one-way rule** by reading the three files. It needs no
  database.
- **The runner's `--createdb` applies the three files in order**, concatenated into one query, so the schema
  still lands completely or rolls back completely.
- **Comment headers are split along with the code.** The ledger design notes (append-only, name-as-spelled
  pointers, corrections vs. changes of belief) go to core, and the derivation narrative goes to taxa.
  Cross-references such as "defined later in this section" are reworded to name the file.
- **BREAKING (for anyone applying the DDL by hand):** `postgresql/create_new.sql` no longer exists.
  `psql -f postgresql/create_new.sql` becomes `cat postgresql/0*.sql | psql` or three `-f` flags in order.

No table, column, constraint, index, function or seed row changes. The database built from the three files
is identical to the one built from `create_new.sql` today.

## Capabilities

### New Capabilities

- `ddl-layout`: the target DDL is three files with a fixed load order and a functional rule for what goes
  where. Dictionaries hold every `dictionaries.*` table. Core holds what the API writes. Taxa holds
  what the rebuild functions write, and those functions. No file refers to an object defined in a later file,
  and a guard test enforces it.

### Modified Capabilities

- `migration-runner`: `--createdb` applies the three DDL files in load order as one query, instead of
  `postgresql/create_new.sql`. It stays atomic and still refuses to run on a populated database.

## Impact

**Source and target**: no data moves. No MariaDB or PBot table is read, and no PostgreSQL table, column,
constraint or seed row changes. No anomaly from `anomaly-report.md` applies. The proof is that a database
built from the three files dumps identically (`pg_dump`, schema and dictionary data) to one built from
`create_new.sql` at the commit before the split. A full migration run with `--createdb` also has to
reproduce the current totals.

**Files**:
- removed: `postgresql/create_new.sql`;
- added: `postgresql/01-dictionaries.sql`, `postgresql/02-core.sql`, `postgresql/03-taxa.sql`, and a guard
  test under `postgresql/tests/`;
- edited: `src/run-migrations.js` (`applyCreateDb()` and three comments), the header comment of
  `payloadSchemas/tests/dictionary-seeds.test.js`, and the `test` script in `package.json` (the new test
  directory);
- specs: `create_new.sql` appears in 16 requirements of six other main specs (`entity-versioning-triggers`,
  `permid-uuidv7`, `taxa-opinions`, `taxa-unified`, `payload-schemas-boundary`, `payload-schema-enums`). None
  of them changes in behaviour, so their wording is updated by hand rather than through delta specs
  (see design);
- docs: the forward-looking references in `docs/monorepo-plan.md`, `docs/api-design-backlog.md` and
  `docs/taxa-opinions-migration-mapping.md`. Historical mentions in design records
  (`docs/classic-taxa-opinions.md`, archived changes, `migration_exploration/`) stay as written.

**pbdb2-api** (separate repo, found during apply): its integration harness
(`test/integration/helpers.js`) loads `../../pbdb2-migrations/postgresql/create_new.sql` into an ephemeral
database, and its `data-access` spec names the file. A missing file makes the harness *skip* the
integration tests, so the split would have disabled them without anyone noticing. A companion commit in
`pbdb2-api` loads `postgresql/[0-9][0-9]-*.sql` in sorted order instead, with the override
`CREATE_SQL_PATH` (a file) replaced by `DDL_DIR` (a directory).

**Collaborators**: the taxa derivation code (Andrew's) moves to `03-taxa.sql`, and the taxonomy dictionaries
move to `01-dictionaries.sql`. Syncs from `postgres-exploration` and any local `psql -f` command need
the new paths, so the split needs announcing. The one open change, `clade-hierarchy-user-guide`, doesn't
touch the DDL. The `graph-visuals` branch doesn't touch `create_new.sql`.

**Dependencies**: none added.

**Out of scope**: moving the files to `db/` (the monorepo change does that); splitting further, for example
separating seed data from dictionary DDL; any change to what a table or function does; building test
databases from the files in `npm test`.
