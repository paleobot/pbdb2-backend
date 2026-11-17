## MODIFIED Requirements

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
