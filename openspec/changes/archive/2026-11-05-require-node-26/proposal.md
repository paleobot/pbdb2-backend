## Why

Hardening against CVE-2026-111497 means running Node.js 26.12.1 or later. The dev server has already been
moved to the latest Node 26, but the repository states no Node version anywhere: no `engines`, no version
file, nothing in the README. The API would start on any Node, and the localhost VM still runs 25.6.1.
This change makes the floor official and makes the API refuse to start below it.

## What Changes

- The root `package.json` declares `"engines": { "node": ">=26.12.1" }`. npm warns on install below it.
- `api/src/app.js` refuses to load on Node below 26.12.1: importing it throws, naming the running and the
  required version. This covers `npm start`, a bare `node src/server.js`, and the test suites, which all
  import `app.js`.
  The guard reads the minimum from `engines.node`, so the version is written once.
- A root `.nvmrc` names the release line, `26`, for nvm and similar tools.
- The README states the prerequisite.
- The localhost VM moves from Node 25.6.1 to the latest Node 26 (nvm), and the test suites are re-run on it.
- **BREAKING** for anyone on an older Node: the API and its tests no longer start there.

## Capabilities

### New Capabilities
- `node-runtime`: the minimum Node.js version the repository requires, where it is declared, the release
  line named for version managers, and the API's refusal to start below the minimum.

### Modified Capabilities
None.

## Impact

- `package.json` (root), new `.nvmrc`, `api/src/app.js`, a new test under `api/test/`, `README.md`.
- The localhost environment: nvm default moves to Node 26; the globally installed `openspec` CLI, which
  lives under the 25.6.1 tree, must be carried over.
- No database, payload or API-contract change; no data-integrity risk.
- The migration scripts are not guarded (see design.md, open question).
