# ddl-layout Specification

## Purpose
Keep the target DDL in three files split by function, with a fixed load order: `01-dictionaries.sql`
(every dictionary table and its seeds), `02-core.sql` (the tables the application writes) and
`03-taxa.sql` (what the rebuild functions write, and those functions). References run one way, from a
file to itself or to earlier files, so the tables the application writes stand on their own. A guard
test in `npm test` enforces the layout without a database.
## Requirements
### Requirement: The DDL is three files with a fixed load order
The target DDL SHALL be exactly three files, applied in this order:
1. `db/01-dictionaries.sql`
2. `db/02-core.sql`
3. `db/03-taxa.sql`

The numeric prefix is the load order. Tools that apply the DDL SHALL take the files in sorted name order,
not from a separately maintained list. "Applying the DDL" in any spec means applying these three files in
this order to an empty database. No other file defines target tables, functions, schemas or extensions.

`db/` is at the repository root, outside every workspace, because the DDL belongs to the backend as a
whole: the migration runner, the API's integration harness and people applying it by hand all read it
from there.

#### Scenario: The files apply in order to an empty database
- **WHEN** the three files are applied in load order to an empty PostgreSQL database with PostGIS available
- **THEN** every statement succeeds and the database has every table, function and dictionary seed of the target schema

#### Scenario: The files can be applied by hand
- **WHEN** someone runs `cat db/0*.sql | psql` against an empty database
- **THEN** the result is the same as the migration runner's `--createdb`

#### Scenario: A fourth file is a spec change
- **WHEN** a fourth `db/NN-*.sql` file is added
- **THEN** the layout guard test fails until this requirement is changed to name it

### Requirement: Objects are placed by function
Each object SHALL go in the file whose function it serves:
- `01-dictionaries.sql`: the `dictionaries` schema and every `dictionaries.*` table with its seed rows,
  including dictionaries used by only one domain (`taxonomy_ranks`, `namechange_reasons`,
  `nomenclatural_statuses`).
- `02-core.sql`: the tables whose rows are written by the application (API or migration), with their
  indexes and the functions and triggers they need. These are the versioning trigger functions, the
  `lookup` schema, the `postgis` extension, the versioned entities from `persons` through `authorities`,
  the opinion ledgers (`name_opinions`, `assignment_opinions`, `validity_opinions`), and the hand-entered
  non-derived tables (`taxon_annotations`, `homonyms`).
- `03-taxa.sql`: the tables whose rows are written by the rebuild functions (`taxa_linnaean`,
  `taxa_clades`, `taxa_attachments`, `taxa`, `cycle_cuts`), with their indexes, every `derive_*`,
  `rebuild_*` and `assert_*_invariant` function, and the `ltree` extension.

A new table goes in `02-core.sql` if the application writes its rows, and in `03-taxa.sql` if a rebuild
function derives them.

#### Scenario: The opinion ledgers are core
- **WHEN** `02-core.sql` is read
- **THEN** it defines `name_opinions`, `assignment_opinions` and `validity_opinions` and their indexes, and `03-taxa.sql` defines none of them

#### Scenario: Taxonomy dictionaries are dictionaries
- **WHEN** `01-dictionaries.sql` is read
- **THEN** it defines `dictionaries.taxonomy_ranks`, `dictionaries.namechange_reasons` and `dictionaries.nomenclatural_statuses` with their seeds

#### Scenario: Derived output is taxa
- **WHEN** `03-taxa.sql` is read
- **THEN** it defines `taxa_linnaean`, `taxa_clades`, `taxa_attachments`, `taxa` and `cycle_cuts`, and every function named `derive_*`, `rebuild_*` or `assert_*_invariant`

### Requirement: No file refers to an object defined in a later file
A file SHALL refer only to objects defined in itself or in an earlier file. A reference is any use outside
a `--` comment: a foreign key, a column type, a call in a function body, a trigger's table or function, or a
name in a string executed as dynamic SQL.

A trigger on a table in an earlier file that executes a function in a later file SHALL be defined in the
later file, after the function. In particular, a trigger on an opinion ledger that runs a derivation or
rebuild function belongs in `03-taxa.sql`.

#### Scenario: Core stands without taxa
- **WHEN** `01-dictionaries.sql` and `02-core.sql` are applied to an empty database without `03-taxa.sql`
- **THEN** both apply cleanly, and every table the application writes exists

#### Scenario: A ledger trigger that rebuilds taxa is defined in the taxa file
- **WHEN** an AFTER STATEMENT trigger on `name_opinions` executing a `rebuild_*` function is added
- **THEN** its `CREATE TRIGGER` statement is in `03-taxa.sql`, and `02-core.sql` does not mention the function

### Requirement: A guard test enforces the layout without a database
The root `npm test` SHALL include a test in `db/tests/` that reads the DDL files, with no database
connection, and fails when:
- the set of `db/NN-*.sql` files is not exactly the three named in this spec; or
- a file mentions, outside `--` comments, the whole-word name of a table, function, schema or extension
  defined in a later file.

Each failure SHALL name the file, the line, the name found, and the later file that defines it. String
literals and function bodies SHALL be searched, not skipped.

#### Scenario: A core reference to a taxa function fails the test
- **WHEN** `02-core.sql` contains, outside a comment, a call to `rebuild_taxa_full()`
- **THEN** the guard test fails and reports `02-core.sql`, the line, `rebuild_taxa_full` and `03-taxa.sql`

#### Scenario: Comments are not references
- **WHEN** a `--` comment in `02-core.sql` mentions `taxa_linnaean` or `derive()`
- **THEN** the guard test passes

#### Scenario: Whole-word matching
- **WHEN** `02-core.sql` contains an identifier such as `taxa_count` that merely begins with a taxa object name
- **THEN** the guard test does not report it as a reference to `taxa`
