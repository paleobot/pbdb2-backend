## MODIFIED Requirements

### Requirement: Paths in a spec are relative to the area that owns it
A path written in a spec SHALL be read relative to the area the spec belongs to:
- Migration specs (`migration-script-layout`, `migration-runner`, `payload-audit`,
  `db-connection-config`, and every spec named `*-migration`): relative to `migrations/`. In these specs,
  "the repository root" means `migrations/`.
- API specs (`api-discovery`, `api-foundation`, `auth-stub`, `csv-output`, `data-access`, `list-pagination`,
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
