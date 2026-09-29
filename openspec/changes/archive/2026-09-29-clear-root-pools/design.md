## Context

Once `move-*-migration-to-src` finished, the root held four pool modules, and the `db-connection-config`
spec named the consumer that justified each one. Since then, those consumers have stopped being live:

| Root module | Consumers | Status |
|---|---|---|
| `pg-pool.js` | `play/server.js` | demo API, superseded by pbdb2-api (its `schema-tree.js` was copied from here) |
| `pg-migrated-pool.js` | `src/opinions-migration/tests/cross-check-aurora.js`; 2 scripts in `migration_exploration/testing/` | one-off check against stale Aurora `pbdb2_migration_test`; not in `npm test` or the runner |
| `pg-classic-pool.js` | 2 scripts in `migration_exploration/testing/` | superseded folder |
| `pg-play-pool.js` | all 25 scripts in `migration_exploration/testing/` | superseded folder |

25 distinct scripts in `testing/` import at least one of the three specialty pools. All of them use the
form `'../../pg-*-pool.js'`.

`migration_exploration/` was decided on 2026-09-29 to be superseded: nothing depends on it, and it moves
into `migrations/` as-is during the monorepo move. Andrew (its main recent author) is unreachable, so
this change must not break his scripts.

## Goals / Non-Goals

**Goals:**
- No pool modules at the repository root; `src/lib/` is the only connection-module set the specs describe.
- `play/` and `cross-check-aurora.js` deleted.
- The `migration_exploration/testing/` scripts keep running exactly as before.

**Non-Goals:**
- Fixing or retiring anything else in `migration_exploration/` or `src/opinions-migration/tests/`
  (`cross-check-reference.js`, the known-broken `reset-opinions.sql`).
- Adding the `.env.example` that `db-connection-config` already requires but the repo lacks. That gap is
  pre-existing and separate.
- Editing the provenance mentions of `pg-classic-pool.js` in `docs/taxa-opinions-migration-mapping.md` or
  the open `clade-hierarchy-user-guide` design. They record where past work ran, not paths to follow.

## Decisions

**Move the specialty pools into `testing/` rather than delete them.** Deleting them would break 25
scripts that Andrew may still run, and gain nothing, because `migration_exploration/` retires with
`migrations/` anyway. Placing the pools next to their only consumers also makes that ownership obvious.
`pg-migrated-pool.js` moves with the other two: without `cross-check-aurora.js` its situation is the
same as theirs.

**Rewrite the imports now.** The monorepo plan leaves `migration_exploration/` paths unfixed, but there
the breakage is a side effect of moving `create_new.sql`. Here the change itself would break them.
The rewrite is mechanical: `'../../pg-X-pool.js'` becomes `'./pg-X-pool.js'`, one form, in 25 files.
The pools call `dotenv/config`, which reads `.env` from the process's working directory, not from the
module's location, so moving them doesn't change which `.env` they load.

**Remove the pools from the spec instead of rewriting their location.** A spec describes the system,
and `migration_exploration/` is by decision not part of it. Keeping a "Postgres-ported Classic
connection module" requirement that points into a superseded folder would commit the specs to
maintaining it. The pools' own header comments already document their env variables.

**Delete `pg-pool.js` together with `play/`.** The spec made `play/server.js` the named reason to
keep the module; once the consumer goes, so does the reason. The "retained root pool" scenario is
removed in the same delta, so the spec never describes a module that doesn't exist.

## Risks / Trade-offs

- [Andrew has local, uncommitted scripts that import `../../pg-play-pool.js`] → Those would break.
  Mitigation: his working tree is his own; the change tells him in the commit message, and the fix is the
  same one-line path change.
- [A missed import in `testing/`] → That script fails at startup with a module-not-found error.
  Mitigation: a task greps for any remaining `../../pg-` specifier and checks that every `./pg-*-pool.js`
  specifier in `testing/` names a file that exists there. Only resolution is checked, not execution: the
  pools exit when their env vars are missing, and the scripts need Andrew's databases.
- [Someone still wanted `play/`] → It remains in git history (last commit bc0dfc0).

## Migration Plan

One commit: delete, move with `git mv` (to keep `--follow` history), rewrite the imports, update specs
and docs. Rollback is `git revert`. No database is involved.

## Open Questions

None.
