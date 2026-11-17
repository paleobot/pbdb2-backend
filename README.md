# pbdb2-backend
The PBDB2 backend: the target PostgreSQL schema, the payload schemas, the REST API, and the migrations
from PBDB Classic and PBot. (This repository was `pbdb2-migrations`; the API was `pbdb2-api`.)

| Directory | Holds |
|---|---|
| `db/` | the target DDL, applied in order: `01-dictionaries.sql`, `02-core.sql`, `03-taxa.sql` |
| `payloadSchemas/` | annotated JSON Schemas for the jsonb payloads, with `lib/` and tests |
| `api/` | the REST API (Fastify); see `api/CLAUDE.md` |
| `migrations/` | migration scripts (`src/`, see `src/README.txt`), legacy analysis (`mariadb/`), `migration_exploration/` |
| `docs/` | documents about the backend as a whole |
| `openspec/` | the OpenSpec specs and changes for every area |
| `tests/` | repository-wide guard tests |

Nothing outside `migrations/` may import or read from it, so it can be deleted when the migrations
retire. `docs/monorepo-plan.md` explains the layout.

## Setup

1. `npm install` at the root (an npm workspaces root; `migrations` and `api` are workspaces).
2. Copy `.env.example` to `.env` at the root and fill it in. It is the one `.env` for every area,
   found whatever directory a command starts in.

## Commands (from the root)

- `npm test`: every suite that needs no database (payload schemas, DDL guard, repository guard,
  migrations, API unit tests).
- `npm run test:integration`: the API's integration suite, against an ephemeral database built from
  `db/`.
- `npm start -w api`: run the API.
- `cd migrations && node src/run-migrations.js --createdb`: the full migration into an empty database.

Note: The scripts in `migrations/` are currently experimental attempts to use Claude Code for this task.
They are not canon until this comment is removed.

Note: The files in the `migrations/mariadb`, `db`, and `payloadSchemas` directories are copied from the pbdb2-dev repo. This was for convenience in setting up Claude context. They must be kept in sync with that repo or the context must be expanded to include that repo.
