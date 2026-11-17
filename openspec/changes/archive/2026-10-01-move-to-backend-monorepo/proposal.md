## Why

The DDL, the payload schemas and the API describe the same data from three sides, but they live in two
repos that nothing keeps in step. The drift is already real: the person-schema conversion (694ff6c) broke
all 27 API integration tests for a week without anyone noticing, and the API is about to depend far more
heavily on the payload schemas (validation, `merge()`/`split()`). Step 4 of `docs/monorepo-plan.md` moves
everything into one repo so that a change to any of the three lands in one commit and is tested by one
`npm test`. Housekeeping and timing (steps 2–3) are done, and neither repo has work in flight.

## What Changes

- **BREAKING (paths):** one ordinary commit moves files into the layout decided in the plan:
  `postgresql/*.sql` and `postgresql/tests/` → `db/`; `src/`, `mariadb/` and `migration_exploration/` →
  `migrations/`; `payloadSchemas/`, `docs/` and `openspec/` stay at the root. Existing history is not
  rewritten, so every cited commit hash stays valid.
- `pbdb2-api`'s history is grafted in under `api/`. Its 16 commits are the only history rewritten.
- The API's OpenSpec specs and archived changes join the root `openspec/` (no name collisions). The
  duplicated `.claude/` and `.github/` OpenSpec skills are kept once, at the root. `openspec/config.yaml`'s
  project context, today written only for the migrations, is rewritten for the whole backend.
- The root `package.json` becomes an npm workspaces root. The migrations and the API each keep their own
  `package.json`; one `npm install` at the root installs everything.
- Every import and file path that pointed at an old location is fixed, including `run-migrations.js`'s
  DDL directory and the API integration harness's `DEFAULT_DDL_DIR`, which stops reaching into a sibling
  checkout. `migration_exploration/` moves as-is and is not fixed up.
- **New rule, enforced:** nothing outside `migrations/` imports or reads from `migrations/`.
- **BREAKING (local setup):** where each `.env` lives and how `*_CA_CERT` paths are resolved are decided
  and documented, since both are found relative to the working directory and commands no longer all run
  from the root. `global-bundle.pem` gets a settled location.
- Specs that name old paths are brought up to date.
- After the move lands and checks pass: `pbdb2-migrations` is renamed `pbdb2-backend` on GitHub, and
  **BREAKING:** `pbdb2-api` is archived (read-only) with a pointer to its new home.

## Capabilities

### New Capabilities
- `repository-layout`: the top-level directories and what each holds; the rule that nothing depends on
  `migrations/` and the test that enforces it; the npm workspaces root; and the convention that paths in a
  migration spec are relative to `migrations/`, while paths in any other spec are relative to the repo root.

### Modified Capabilities
- `ddl-layout`: the three DDL files and their guard test live in `db/`, not `postgresql/`.
- `migration-runner`: `--createdb` reads the DDL from `db/`, outside `migrations/` (allowed: the runner is
  on the dependent side of the rule).
- `payload-schemas-boundary`: the directories it names as off-limits are now `migrations/` (and, under the
  same rule, `api/`), not `src/` and `migration_exploration/`; its examples are updated.
- `db-connection-config`: where `.env` is read from and how relative `*_CA_CERT` paths resolve after the
  move; its references to `migration_exploration/testing/` pools follow the folder.
- `data-access` (from the API): its integration harness loads the DDL from `db/` in the same repo, not
  from `pbdb2-migrations/postgresql/` in a sibling checkout.

Migration specs whose paths are only under `src/` (for example `migration-script-layout`, `permid-uuidv7`
and the `*-migration` specs) need no delta: under the `repository-layout` convention their `src/…` paths
already mean `migrations/src/…`. The API's other specs join unchanged; their paths mean `api/…`.

## Impact

- **Code:** import and path fixes across `migrations/src/` (runner, tests, `audit-payloads.js`),
  `payloadSchemas/tests/`, `db/tests/ddl-layout.test.js`, and `api/test/integration/helpers.js`. No change
  to migration logic, DDL content, payload schemas or API behaviour.
- **Checks that must pass before the move is done:** root `npm test` (migrations, payload schemas, DDL
  guard and API unit tests); the full migration run reproduces its current totals; the API integration
  suite (27 tests) passes against the DDL in `db/`.
- **Contributors:** a one-time `git pull` and `npm install` at the root; local paths such as `psql -f
  postgresql/01-dictionaries.sql` become `db/…`; `.env` placement per the new instructions; optionally
  update the remote URL (GitHub redirects the old one).
- **Repos:** `pbdb2-migrations` renamed; `pbdb2-api` archived. Open issues and PRs stay where they are.
- **Out of scope:** retiring `migrations/`; fixing `migration_exploration/` scripts; a fresh test database
  built from the DDL for the API beyond what its harness already does; the frontend.
