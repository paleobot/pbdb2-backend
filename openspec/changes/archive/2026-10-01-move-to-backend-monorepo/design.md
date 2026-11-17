## Context

`pbdb2-migrations` holds the DDL (`postgresql/01`–`03-*.sql` and its guard test), the payload schemas
(`payloadSchemas/`), the migration scripts (`src/`), the legacy analysis (`mariadb/`) and a superseded
exploration folder (`migration_exploration/`). `pbdb2-api` is a separate repo with 16 commits, its own
`openspec/` (8 specs, 9 archived changes), `.env`, `.env.example`, `CLAUDE.md` and OpenSpec skill copies.
The API's integration harness reaches the DDL through `../../../pbdb2-migrations/postgresql`, a path to a
sibling checkout.

Facts that shaped the decisions:
- Both local `.env` files hold identical `PG_HOST`/`PG_PORT`/`PG_USER`/`PG_PASSWORD`/`PG_DATABASE`: the
  migrations, the payload-schema DB tests and the API talk to the same database. The migrations' `.env`
  adds `MARIADB_*`, `PG_MIGRATED_*` and `PBOT_TOKEN`.
- Every loader reads `.env` with `import 'dotenv/config'`, which resolves against the working directory,
  and every `*_CA_CERT` path is passed straight to `readFileSync`, so a relative one also resolves against
  the working directory. Today everything runs from the repo root, so both work. npm runs a workspace's
  scripts in that workspace's directory, so after the move they would not.
- `payloadSchemas/` imports `ajv`, `dotenv` and `pg`; `postgresql/tests/` imports nothing from npm.
- `migrations/src/run-migrations.js` and two opinions test runners compute a `REPO_ROOT` by walking up from
  their own file.
- The API's `data-access` spec names `pbdb2-migrations/postgresql/`.
- The migrations repo has no `.env.example`, although `db-connection-config` requires one.
- `git filter-repo` is not installed here.

The step-by-step order and the reasons for the monorepo are in `docs/monorepo-plan.md`; this document
settles how.

## Goals / Non-Goals

**Goals:**
- Reach the layout in the plan with existing migrations history untouched and every cited hash valid.
- One `npm install` and one `npm test` at the root covering the payload schemas, the DDL guard, the
  migrations' tests and the API's unit tests.
- Every command finds the same `.env` and certificate whatever directory it starts in.
- Make the "nothing depends on `migrations/`" rule a failing test, not a convention.
- Keep the spec edits to the places where a requirement's meaning changes.

**Non-Goals:**
- Changing migration logic, DDL content, payload schemas or API behaviour.
- Fixing `migration_exploration/` (it moves as-is and may stay broken).
- Retiring `migrations/`; the frontend; deployment configuration for the API.
- A shared runtime helper package for the three areas.

## Decisions

### D1. One `.env` and the certificate at the repo root, loaded by explicit path

A single `.env` lives at the repo root, next to `global-bundle.pem`, which stays where it is. Each area
loads `.env` from the root by a path computed from its own file (`new URL(…, import.meta.url)`), not from
the working directory. A relative `*_CA_CERT` value is resolved against the repo root; an absolute one is
used as-is. So `PG_CA_CERT=global-bundle.pem` works from any directory, and the absolute paths people
already use keep working.

The loaders touched: in the migrations, `src/lib/pg-pool.js`, `src/lib/mariadb-pool.js`,
`src/run-migrations.js` and the two opinions test runners; `payloadSchemas/tests/pg.js`; in the API,
`src/server.js`, `src/config.js` / `src/plugins/postgres.js`, and `test/integration/helpers.js`. Each area
keeps its own two or three lines: the dependency rule (D5) and `payload-schemas-boundary` forbid a shared
helper across `migrations/`, `payloadSchemas/` and `api/`.

dotenv neither overrides variables already set nor fails when the file is absent, so a deployed API that
gets its settings from the real environment is unaffected.

A root `.env.example` covering every variable (target PG, CA certificate, MariaDB, PBot token, the
optional `PG_REF_DATABASE`) is committed; the API's `.env.example` is folded into it and removed. This
also closes the missing-`.env.example` gap in `db-connection-config`.

`payload-schemas-boundary` gains one stated exception: `payloadSchemas/tests/pg.js` may read the root
`.env`. It is local configuration, not code, and the boundary exists to keep code dependencies one-way.

*Alternative rejected: per-app files* (`migrations/.env`, `api/.env`, working-directory loading kept).
No loader changes, but the database credentials would be duplicated in two files that must agree, and the
`payloadSchemas/` DB tests, which run from the root, would need a third copy there.

*Alternative rejected: keep working-directory loading and always run from the root.* It breaks on the
first `npm -w api test` or `cd migrations && node src/run-migrations.js`, silently, with a missing-variable
error that doesn't point at the cause.

### D2. The API's history is rewritten under `api/` with `git filter-repo`, then merged

On a fresh clone of `pbdb2-api`, `git filter-repo --to-subdirectory-filter api` rewrites its 16 commits so
every path is under `api/`. That clone is fetched into the backend repo and merged with
`--allow-unrelated-histories`. `git log --follow` and blame on `api/…` files then reach back to the API's
first commit. `git-filter-repo` is installed for this (Ubuntu package `git-filter-repo`).

The rewritten commits get new hashes. Hashes cited from the old API history (for example `d89143b` in the
migrations' memory notes and commit messages) stay resolvable in the archived `pbdb2-api` repo.

*Alternative rejected: `git subtree add --prefix=api`.* No rewrite, but the API's commits keep their
original root-level paths, so history for `api/src/app.js` stops at the merge unless `--follow` guesses
the rename. *Alternative rejected: copy the files without history.* Loses 16 commits of reasoning that the
archived specs cite.

### D3. Moves and fixes in separate commits, pushed together

The first commit is pure `git mv` (every entry a 100% rename), so rename detection is certain for every
file. The path fixes, workspaces setup, spec deltas and guard test follow in later commits. The graft
merge is its own commit. Nothing is pushed until every check in "Migration Plan" passes on the final
commit.

The commits between the move and the fixes don't pass `npm test`. That matters only to someone bisecting
across the move, and the commit message says so.

*Alternative rejected: one commit that moves and edits.* Git counts a moved file as a rename only if it
stays similar enough to the original, and a heavily edited small file can fall below that and show as a
delete plus an add, breaking `--follow` for it.

### D4. npm workspaces: root plus `migrations` and `api`

The root `package.json` becomes `private`, with `"workspaces": ["migrations", "api"]`. The current root
`package.json` moves to `migrations/package.json`, keeping its dependencies. The root declares the
dependencies of the root-level code (`payloadSchemas/`, `db/tests/`, the layout guard): `ajv`, `dotenv`
and `pg`. There is one root `package-lock.json`; the API's lockfile is removed.

Root scripts:
- `test`: `node --test` over `payloadSchemas/tests/`, `db/tests/` and `tests/`, then
  `npm test -w migrations` and `npm test -w api`.
- `test:integration`: `npm run test:integration -w api` (needs a database, so it stays separate).

`payloadSchemas/` does not become a workspace. It has no consumers that install it by name; everything
imports it by relative path.

### D5. The dependency rule is a guard test at the root

`tests/repository-layout.test.js` scans every `.js` file outside `migrations/` and `node_modules/`
(`payloadSchemas/`, `db/`, `api/`, `tests/`) using the same approach as
`payloadSchemas/tests/boundary.test.js`: relative `import`/`from`/dynamic `import()` specifiers and
`new URL('…', import.meta.url)` reads, with comment lines skipped. It fails, naming the file and the
specifier, if any of them resolves into `migrations/`.

The payload-schemas boundary test stays as it is; it enforces the stricter rule for `payloadSchemas/`.

*Alternative rejected: extending the payload-schemas boundary test.* That test belongs to one directory's
spec; the monorepo rule belongs to `repository-layout`.

### D6. Spec paths are relative to the area that owns the spec

`repository-layout` states the convention and lists the areas:
- Migration specs (the `*-migration` specs, `migration-runner`, `migration-script-layout`,
  `permid-uuidv7`, `payload-audit`, `db-connection-config`): paths and "the repository root" mean
  `migrations/`.
- API specs (`api-discovery`, `api-foundation`, `auth-stub`, `data-access`, `list-pagination`,
  `reference-enrichment`, `resource-routes`, `taxa-reads`): paths mean `api/`.
- Every other spec: paths are relative to the repo root.

Without this, the roughly 15 migration specs that say `src/…` would each need a delta that changes nothing
but a prefix, and both the migrations and the API have a `src/`, so bare paths would be ambiguous anyway.
The five deltas in the proposal are the specs whose requirements change meaning, not just their prefix.

*Alternative rejected: rewrite every path in every spec.* Around 200 edits across 15 specs for no change
in behaviour, and it would make those specs' histories noisy.

### D7. One OpenSpec root; skills regenerated there

The API's `openspec/specs/*` move to the root `openspec/specs/` (no names collide) and its
`openspec/changes/archive/*` to the root archive (no names collide). `api/openspec/` is then removed.
`openspec/config.yaml`'s project context, today only about the migrations, is rewritten to describe the
backend: the DDL, the payload schemas, the API and the migrations, and the dependency rule.

The API's `.claude/` and `.github/` OpenSpec skill and command copies (from a different OpenSpec profile)
are removed, and `openspec update` is run once at the root. `api/CLAUDE.md` stays; its "separate repos"
wording and layout notes are corrected.

### D8. Paths that cross areas after the move

- The API's integration harness: `DEFAULT_DDL_DIR` becomes `db/` in the same repo
  (`../../../db` from `api/test/integration/`). `DDL_DIR` still overrides it.
- `run-migrations.js`: `--createdb` reads `db/`. Its `REPO_ROOT` (and the two opinions test runners')
  keeps meaning the migrations root, and a separate constant names the backend root for `db/` and `.env`.
- `.gitignore`: root entries under `src/` and `migration_exploration/` get the `migrations/` prefix. The
  API's `.gitignore` stays at `api/.gitignore`.

## Risks / Trade-offs

- [A file silently fails rename detection] → pure-rename first commit (D3); after it, check that
  `git show --stat -M` lists only renames.
- [The migration run no longer reproduces its totals because of a missed path] → the full run on
  localhost is a required check; the runner's own preflight assertions fail loudly on a missing DDL or
  input file.
- [The API integration suite skips instead of failing when it can't find the DDL] → the check requires
  27 run and passed, not just "no failures".
- [Collaborators' local `.env` is left at the old place or duplicated] → `docs/monorepo-plan.md` "After the
  move" gives the exact step: one `.env` at the root, from `.env.example`; delete any `api/.env` or
  `migrations/.env`.
- [Spec readers misread `src/…` in a migration spec as the API's `src/`] → the convention is stated once
  in `repository-layout` and each area's list is explicit there.
- [Claude Code's per-project memory is keyed by the local directory path] → if the local folder is
  renamed to `pbdb2-backend`, copy the memory folder to the new key (recorded in the monorepo memory note).

## Migration Plan

1. Install `git-filter-repo`. Confirm `main` and `ddm-dev` are level and pushed, and the working tree is
   clean in both repos. Tag the pre-move commit `pre-monorepo` (local tag; it is the rollback target).
2. Commit the pure move (D3).
3. Graft the API (D2) as a merge commit.
4. Fix paths, loaders, `.gitignore` and workspaces (D1, D4, D8); move the OpenSpec content and regenerate
   skills (D7); add the layout guard (D5); add the root `.env.example`. Create the root `.env` locally.
5. Checks, all on the final commit: root `npm test` passes; `npm run test:integration` runs 27 tests and
   all pass; the full migration run reproduces its current totals; the new layout guard fails when a test
   import into `migrations/` is added, and passes when it is removed. The migration run goes into a fresh
   scratch database (created empty with `createdb`, then initialized by the runner's `--createdb`, with
   `PG_DATABASE` overridden for that run only), never the
   working `pbdb`: a run that fails halfway would leave the working database partly migrated, and
   `--createdb` refuses to reset a populated one. The scratch database is dropped afterwards.
**Stop here.** Applying this change pauses after step 5, with everything committed locally and nothing
pushed, for the user's review. Steps 6 and 7 start only on the user's explicit go-ahead.

6. Push `ddm-dev`, fast-forward `main`, push.
7. Rename `pbdb2-migrations` to `pbdb2-backend` on GitHub; update the local remote URL. Archive
   `pbdb2-api` with a README pointer to `pbdb2-backend/api/`.

### Rollback

Rollback gets harder with each stage, but mostly with time: the more work lands in the new layout, the
more a rollback means porting that work back.

**Before the push (steps 2–5).** Nothing has left the machine. `git reset --hard pre-monorepo`, then
`npm install` (workspaces change the `node_modules` layout). The rollback is complete:
- The API rewrite (D2) runs on a fresh clone in a scratch directory; the `../pbdb2-api` checkout and the
  GitHub repo are never touched.
- `.env` stays at the root under D1, where the old loaders also read it, so nothing moves back.
- No database needs restoring, because the migration-run check used a scratch database (step 5).

**After the push (step 6).** In order of preference:
1. *Fix forward.* The likely failure is a missed path, which is a one-line commit, not a rollback.
2. *Revert.* One `git revert` of the move, fix and merge commits (the merge needs `-m 1`). The old layout
   returns as an ordinary commit that anyone can pull; history records both the move and its reversal.
   The rewritten API commits stay in the graph, inert.
3. *Reset and force-push* to `pre-monorepo`. This removes the move from `main` entirely, but it is safe
   only if nobody has pulled since the push, which can't be confirmed; anyone who did is left with
   orphaned commits. Branch protection may also refuse it. Not recommended.

**After the rename (step 7).** Rename `pbdb2-backend` back to `pbdb2-migrations` in the GitHub settings.
GitHub redirects in both directions, so clones on either URL keep working; resetting the local remote URL
is optional. The redirect breaks only if someone creates a new `pbdb2-migrations` repo in the org
meanwhile.

**After the archive (step 7).** Unarchive `pbdb2-api` in its settings. Archiving only makes it read-only;
history, issues and PRs are untouched.

**Once real work has landed in `api/`,** going back to a separate `pbdb2-api` means porting those commits
out (`git format-patch --relative=api` produces patches that apply at the API repo's root), with new
hashes. After a few days of normal use, fixing forward is the only reasonable option, which is why the
step 5 checks must all pass before the push.

## Open Questions

- None blocking. The "After the move" section of `docs/monorepo-plan.md` is what collaborators follow;
  it is updated in this change for the single root `.env`.
