## MODIFIED Requirements

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
- **WHEN** a file under `api/src/` contains `import { pg } from '../../migrations/src/lib/pg-pool.js'`
- **THEN** the rule is broken

#### Scenario: The runner reads the DDL
- **WHEN** `migrations/src/run-migrations.js` reads `db/01-dictionaries.sql`
- **THEN** the rule is not broken, because the dependency points out of `migrations/`

#### Scenario: A provenance comment
- **WHEN** a comment in `payloadSchemas/authority.schema.js` names `migrations/src/authorities-migration`
- **THEN** the rule is not broken

### Requirement: Paths in a spec are relative to the area that owns it
A path written in a spec SHALL be read relative to the area the spec belongs to:
- Migration specs (`migration-script-layout`, `migration-runner`, `payload-audit`,
  `db-connection-config`, and every spec named `*-migration`): relative to `migrations/`. In these specs,
  "the repository root" means `migrations/`.
- API specs (`api-discovery`, `api-foundation`, `auth-stub`, `data-access`, `list-pagination`,
  `reference-enrichment`, `resource-routes`, `taxa-reads`): relative to `api/`.
- Every other spec, including `prefixed-permids`: relative to the repository root.

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
