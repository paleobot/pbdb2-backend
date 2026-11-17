## MODIFIED Requirements

### Requirement: `--createdb` initializes an empty database and cannot reset a populated one
When `--createdb` is passed, the runner SHALL apply the DDL: the files `db/[0-9][0-9]-*.sql` in `db/` at
the repository root, outside `migrations/` (`01-dictionaries.sql`, `02-core.sql`, `03-taxa.sql`, see
`ddl-layout`), read in sorted name order and concatenated, executed as a single `pg` query through the
existing pool, before preflight's dictionary and emptiness checks and before the first step. The runner
SHALL locate `db/` from its own file's location, not from the working directory. Reading `db/` from
`migrations/` is the permitted direction of `repository-layout`'s dependency rule.

The files contain no `psql` meta-commands, no `COPY`, and no explicit `BEGIN`/`COMMIT`, so PostgreSQL
executes the concatenation as one implicit transaction: it either applies completely or rolls back
completely. The runner SHALL NOT shell out to `psql`, which would require an external binary and a
separately constructed connection string and would leave a partially built schema on failure.

The files have no top-level `DROP`, and the concatenation begins with `01-dictionaries.sql`'s unqualified
`CREATE SCHEMA dictionaries`, so applying it to a database that already has that schema fails before any
row is touched. `--createdb` therefore initializes an empty database and SHALL NOT be described or used as
a way to reset a populated one. Creating the database itself is outside the runner's scope.

#### Scenario: Schema is applied atomically
- **WHEN** `--createdb` is passed against an empty database and a statement in any of the three files fails
- **THEN** the whole script rolls back and the database is left empty, rather than partially built, even if earlier files applied without error

#### Scenario: Files are applied in load order
- **WHEN** `--createdb` is passed against an empty database
- **THEN** `01-dictionaries.sql`, `02-core.sql` and `03-taxa.sql` are applied in that order, and the resulting schema and dictionary seeds are the complete target DDL

#### Scenario: The DDL is found from any working directory
- **WHEN** the runner is started with `--createdb` from `migrations/` or from the repository root
- **THEN** it applies the files in `db/` at the repository root in both cases

#### Scenario: Populated database is protected
- **WHEN** `--createdb` is passed against a database that already contains the `dictionaries` schema
- **THEN** the operation fails on `CREATE SCHEMA dictionaries` without modifying any data, and the runner reports that `--createdb` initializes an empty database rather than resetting an existing one

#### Scenario: Database creation is out of scope
- **WHEN** `PG_DATABASE` names a database that does not exist
- **THEN** the runner fails to connect during preflight and reports that the database must be created before `--createdb` is used
