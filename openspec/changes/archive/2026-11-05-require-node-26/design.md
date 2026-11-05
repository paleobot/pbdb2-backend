## Context

CVE-2026-111497 is fixed in Node.js 26.12.1. The dev server already runs the latest Node 26. The repository
states no Node version: there is no `engines` field in any of the three `package.json` files, no `.nvmrc`,
no `.npmrc`, no CI workflow and no Dockerfile, and the README says nothing. The localhost VM runs Node
25.6.1 through nvm, with no other version installed, and the `openspec` CLI is installed globally under that
25.6.1 tree.

No dependency limits the choice: the strictest `engines.node` in `package-lock.json` is `>=22`, and none of
the dependencies is a native module (`pg-native` is an optional peer that is not installed).

## Goals / Non-Goals

**Goals:**
- Declare the minimum, `>=26.12.1`, in one place, which both npm and the API guard read.
- Name the Node release line for version managers (`.nvmrc`), as the other repositories do.
- Make the API fail to start below the minimum, however it is launched.
- Move localhost onto Node 26 and prove the suites pass there.

**Non-Goals:**
- `engine-strict=true` in an `.npmrc`. It would turn npm's install warning into an error, but the guard is the
  enforcement; the `engines` field is the declaration.
- Guarding the migration scripts (see Open Questions).
- Pinning a Node version on the dev server. It is already upgraded and is outside this repository.

## Decisions

**1. `engines` in the root `package.json` only.** One `npm install` at the root installs every workspace, so
the root is where npm checks. Repeating the field in `api/` and `migrations/` would be three copies to keep
in step for no extra check. *Alternative:* `devEngines.runtime` with `onFail: "error"` (npm 11), which makes
npm commands fail on the wrong Node. Rejected to match the pattern already used in the other repositories,
and because it still would not cover a bare `node src/server.js`.

**2. The guard runs at module load in `api/src/app.js`.** `app.js` is the one module that the server entry
and every API test (unit and integration) import, so a top-level check covers `npm start`, `node
src/server.js` and the test suites with one piece of code. Putting it in `server.js` would leave the tests
running on an old Node; putting it inside `build()` would let a module that imports `app.js` for its exports
(`DEFAULT_PUBLIC_BASE_URL`) load unchecked.

**3. A hand-written numeric comparison, not the `semver` package.** The check compares three integers.
`semver` is only a transitive dependency; depending on it directly adds a package for six lines. The
comparison is a small exported function so the spec's edge cases (26.12.0, 26.12.1, 26.100.0, 27.0.0) can be
unit-tested without changing the running Node.

**4. The guard reads the minimum from the root `package.json`.** `app.js` imports it with
`import pkg from '../../package.json' with { type: 'json' }`, so `engines.node` is the only place the minimum
is written and raising it is a one-line change. The import points at the repository root, not `migrations/`,
so the dependency rule holds. The guard accepts only `>=MAJOR.MINOR.PATCH` and throws on anything else, so it
never has to interpret a general semver range. *Alternative:* a constant in `app.js` held to `engines.node`
by a test. Rejected: two copies plus a test to keep them equal, where one copy needs neither.

**5. `.nvmrc` names the major version only: `26`.** `nvm install` then fetches the latest 26, which picks
up later security patches. Pinning `26.12.1` would install exactly that release and fall behind. With the
major alone, `.nvmrc` does not repeat the patch floor, so it changes only at the next major. The weak spot:
`nvm use` picks the newest 26 *already installed*, which could be below 26.12.1 on a stale machine. The guard
catches that, with a message naming both versions. *Alternative:* no version file. Rejected for consistency
with the other repositories, and because nvm, fnm and `setup-node` (`node-version-file`) all read it.

**6. Localhost upgrade carries the global packages.** With `.nvmrc` in place,
`nvm install --reinstall-packages-from=25.6.1` at the root, then `nvm alias default 26`, so the `openspec` CLI comes along. `node_modules` needs no rebuild because nothing
in it is native; the suites (`npm test`, `npm run test:integration`) are the proof.

## Risks / Trade-offs

- [The guard throws inside every test file that imports `app.js` on an old Node, so a developer on Node 25
  sees many failures] → Each failure carries the same message naming both versions; that is the intended
  signal.
- [The API now needs the root `package.json` at run time, so copying `api/` out on its own would break the
  guard] → The API always runs from inside the monorepo; the import fails loudly if that ever changes.
- [Someone writes `engines.node` as `^26.12.1` or `>=26`] → The guard refuses to load and names the value.
- [The `openspec` CLI is missing after the upgrade if the reinstall flag is forgotten] → It is a task step,
  with a check that `openspec --version` still runs.
- [nvm keeps 25.6.1 installed; a shell could still select it] → The guard stops the API there. Uninstall
  25.6.1 once 26 is confirmed working.

## Migration Plan

1. Add `.nvmrc` and upgrade localhost to Node 26 from it first, so the guard does not lock this VM out of its
   own tests.
2. Add `engines`, the guard, its tests and the README line; run `npm test` and `npm run test:integration`.
3. Rollback: revert the commit. The localhost Node can stay on 26 either way.

## Open Questions

- **Migrations are not guarded.** `migrations/src/run-migrations.js` and its step scripts do not import
  `app.js`, so they run on any Node. They run only from the localhost VM, which this change moves to 26, they
  do not listen on a network, and they retire with PBDB Classic and PBot. Lean: leave them unguarded. Revisit
  if the CVE turns out to matter for outbound clients (`pg`, `mysql2`) rather than servers.
