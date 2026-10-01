# repository-layout Specification

## Purpose
Fix the backend repository's top-level areas and what each holds; the rule that nothing depends on
`migrations/`, and the guard test that enforces it; the npm workspaces root and its single root `.env`;
and the convention that paths in a migration spec are relative to `migrations/`, while paths in any other
spec are relative to the repository root.

## Requirements
### Requirement: The repository has a fixed set of top-level areas
The repository SHALL be organized into these top-level directories, each with one purpose:

| Directory | Holds | Lifetime |
|---|---|---|
| `db/` | the target DDL (`NN-*.sql`) and its guard test (`db/tests/`) | lasting |
| `payloadSchemas/` | the annotated payload schemas, `lib/` and their tests | lasting |
| `api/` | the REST API (formerly the `pbdb2-api` repo) | lasting |
| `migrations/` | the migration scripts (`src/`), legacy analysis (`mariadb/`) and `migration_exploration/` | retires when PBDB Classic and PBot shut down |
| `docs/` | documents about the backend as a whole | lasting |
| `openspec/` | the single OpenSpec root for every area | lasting |
| `tests/` | repository-wide guard tests | lasting |

The repository root also holds the workspaces `package.json`, `.env.example` and `global-bundle.pem`. No
area's source code lives directly at the root.

#### Scenario: Root listing after the move
- **WHEN** the repository root is listed
- **THEN** it contains the directories above, and no `src/`, `postgresql/`, `mariadb/` or
  `migration_exploration/` directory

#### Scenario: A new migration script
- **WHEN** a new migration script is written
- **THEN** it goes under `migrations/src/`, following `migration-script-layout`

### Requirement: Nothing outside `migrations/` depends on it
No file outside `migrations/` SHALL import from, or read a file under, `migrations/`. A relative import
specifier (static `import … from`, side-effect `import '…'`, or dynamic `import('…')`) and a file read
through `new URL('…', import.meta.url)` in any `.js` file outside `migrations/` SHALL resolve to a path
outside `migrations/`.

The rule is one-way: code under `migrations/` MAY import from or read `db/`, `payloadSchemas/` and the root
`.env`. Comments are not imports; a comment citing a migration script as the origin of a stored shape does
not break the rule.

The purpose is that `migrations/` and its specs can be deleted in one change when the migrations retire,
and nothing else breaks.

#### Scenario: The API imports a migration helper
- **WHEN** a file under `api/src/` contains `import { uuidv7 } from '../../migrations/src/lib/uuidv7.js'`
- **THEN** the rule is broken

#### Scenario: The runner reads the DDL
- **WHEN** `migrations/src/run-migrations.js` reads `db/01-dictionaries.sql`
- **THEN** the rule is not broken, because the dependency points out of `migrations/`

#### Scenario: A provenance comment
- **WHEN** a comment in `payloadSchemas/authority.schema.js` names `migrations/src/authorities-migration`
- **THEN** the rule is not broken

### Requirement: A guard test enforces the dependency rule
A guard test SHALL live at `tests/repository-layout.test.js` and run in the root `npm test`. It SHALL scan
every `.js` file outside `migrations/` and `node_modules/`, and fail when any relative import specifier or
`new URL(…, import.meta.url)` read resolves inside `migrations/`. Lines that begin as comments SHALL be
skipped. The failure message SHALL list each offending file and specifier. The guard SHALL need no
database connection.

#### Scenario: Clean tree
- **WHEN** the root `npm test` runs on the moved repository
- **THEN** the guard test passes

#### Scenario: A violation is caught
- **WHEN** a file under `api/test/` imports `../../migrations/src/lib/pg-pool.js`
- **THEN** the root `npm test` fails at the guard test, naming that file and specifier

#### Scenario: Runs without a database
- **WHEN** no `PG_*` variable is set
- **THEN** the guard test still runs and reports its result

### Requirement: The root is an npm workspaces root
The root `package.json` SHALL be `private` and declare `migrations` and `api` as workspaces. Each workspace
SHALL keep its own `package.json` and `test` script. The root `package.json` SHALL declare the npm
dependencies of the code that lives outside both workspaces (`payloadSchemas/`, `db/tests/`, `tests/`).
There SHALL be one `package-lock.json`, at the root.

One `npm install` at the root SHALL install everything. The root `test` script SHALL run
`payloadSchemas/tests/`, `db/tests/` and `tests/`, then each workspace's `test` script. The root
`test:integration` script SHALL run the API's `test:integration` script, which needs a database and is
therefore not part of `npm test`.

#### Scenario: Fresh clone
- **WHEN** someone clones the repository and runs `npm install` then `npm test` at the root
- **THEN** every suite runs (payload schemas, DDL guard, repository guard, migrations, API unit tests)
  without any further install step

#### Scenario: One workspace alone
- **WHEN** someone runs `npm test -w api`
- **THEN** only the API's unit tests run

### Requirement: One `.env` at the root, found from any directory
Local configuration SHALL live in a single `.env` at the repository root, never committed. Every area that
loads `.env` SHALL load that file by a path computed from its own source file's location, not from the
working directory, so that a command finds the same `.env` whatever directory it starts in. Variables
already set in the environment SHALL take precedence over `.env`, and a missing `.env` SHALL NOT by itself
be an error.

A `*_CA_CERT` variable whose value is a relative path SHALL be resolved against the repository root; an
absolute path SHALL be used as given. The AWS RDS certificate bundle is committed at the root as
`global-bundle.pem`, so `PG_CA_CERT=global-bundle.pem` works from any directory.

A root `.env.example` SHALL be committed, listing every variable read by `migrations/`, `payloadSchemas/`
and `api/`, with placeholder values.

#### Scenario: The runner started from its workspace
- **WHEN** someone runs `node src/run-migrations.js` from `migrations/`
- **THEN** it reads the root `.env`

#### Scenario: The API started through npm
- **WHEN** someone runs `npm start -w api`, whose working directory is `api/`
- **THEN** the API reads the root `.env`

#### Scenario: A shell override wins
- **WHEN** `PG_DATABASE=scratch` is set in the shell and the root `.env` sets another database
- **THEN** the process connects to `scratch`

#### Scenario: A relative certificate path
- **WHEN** the root `.env` sets `PG_CA_CERT=global-bundle.pem` and a command starts in `api/`
- **THEN** the certificate is read from the root `global-bundle.pem`

#### Scenario: A deployed API with no `.env`
- **WHEN** the API runs where no `.env` file exists and its variables are set in the environment
- **THEN** it starts normally using those variables

### Requirement: Paths in a spec are relative to the area that owns it
A path written in a spec SHALL be read relative to the area the spec belongs to:
- Migration specs (`migration-script-layout`, `migration-runner`, `permid-uuidv7`, `payload-audit`,
  `db-connection-config`, and every spec named `*-migration`): relative to `migrations/`. In these specs,
  "the repository root" means `migrations/`.
- API specs (`api-discovery`, `api-foundation`, `auth-stub`, `data-access`, `list-pagination`,
  `reference-enrichment`, `resource-routes`, `taxa-reads`): relative to `api/`.
- Every other spec: relative to the repository root.

A path that crosses areas SHALL be written from the repository root and say so (for example, "`db/`
at the repository root"). A new spec SHALL follow the convention of the area it belongs to, and a new
migration or API spec SHALL be added to the lists above.

#### Scenario: A migration spec names `src/lib/pg-pool.js`
- **WHEN** `db-connection-config` names `src/lib/pg-pool.js`
- **THEN** it means `migrations/src/lib/pg-pool.js`

#### Scenario: An API spec names `src/app.js`
- **WHEN** an API spec names `src/app.js`
- **THEN** it means `api/src/app.js`

#### Scenario: A lasting spec names `payloadSchemas/lib/`
- **WHEN** `payload-schema-variants` names `payloadSchemas/lib/variants.js`
- **THEN** the path is relative to the repository root
