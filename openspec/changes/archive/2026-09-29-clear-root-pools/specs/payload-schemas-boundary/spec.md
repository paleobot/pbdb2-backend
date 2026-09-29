## MODIFIED Requirements

### Requirement: `payloadSchemas/` depends on nothing outside itself
Every JavaScript file under `payloadSchemas/`, including its tests, SHALL import and read only:
- files under `payloadSchemas/`;
- npm packages (bare specifiers such as `ajv/dist/2019.js`, `pg`, `dotenv/config`);
- Node built-ins (`node:` specifiers).

A relative import specifier (static `import … from`, side-effect `import '…'`, or dynamic `import('…')`) and a
file read through `new URL('…', import.meta.url)` SHALL resolve to a path inside `payloadSchemas/`. In
particular, nothing under `payloadSchemas/` SHALL import from `src/` or `migration_exploration/`.

The rule is one-way. Code outside `payloadSchemas/` MAY import from it, including its test fixtures:
`src/collections-migration/tests/test-collections-transforms.js` reading
`payloadSchemas/tests/fixtures/legacy-enums.json` is allowed.

Comments are not imports. A comment that cites a migration script as the origin of a stored shape (for
example, "the jsonb keys are the ones `src/authorities-migration` writes") does not violate the rule.

#### Scenario: A test imports the migrations' pool
- **WHEN** a file under `payloadSchemas/tests/` contains `import { pg } from '../../src/lib/pg-pool.js'`
- **THEN** the boundary guard test fails, naming that file and the specifier

#### Scenario: A fixture read that escapes the directory
- **WHEN** a file under `payloadSchemas/` reads `new URL('../../src/opinions-migration/inputs/x.csv', import.meta.url)`
- **THEN** the boundary guard test fails, naming that file and the path

#### Scenario: Package and built-in imports pass
- **WHEN** `payloadSchemas/lib/ajv.js` imports `ajv/dist/2019.js` and a test imports `node:test`
- **THEN** the guard test passes those specifiers

#### Scenario: Migrations importing payloadSchemas is allowed
- **WHEN** `src/audit-payloads.js` imports `../payloadSchemas/collection.schema.js`
- **THEN** no rule is broken, and the guard test does not inspect files outside `payloadSchemas/`

#### Scenario: A comment naming a migration path
- **WHEN** a `*.schema.js` header comment mentions `src/authorities-migration`
- **THEN** the guard test passes, because it inspects import specifiers and `import.meta.url` reads, not comment text
