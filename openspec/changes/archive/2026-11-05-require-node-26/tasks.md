## 1. Localhost environment

- [x] 1.1 Record the baseline: `node --version` (25.6.1), `openspec --version`, and `npm test` passing on 25.6.1
- [x] 1.2 Add `.nvmrc` at the repository root containing `26`
- [x] 1.3 At the root, `nvm install --reinstall-packages-from=25.6.1` (reads `.nvmrc`); confirm `node --version` is ≥ 26.12.1
- [x] 1.4 `nvm alias default 26`; confirm a new shell starts on Node 26 and `openspec --version` still runs
- [x] 1.5 Run `npm test` and `npm run test:integration` on Node 26, before any other repo change, and confirm both pass

## 2. Declare the minimum

- [x] 2.1 Add `"engines": { "node": ">=26.12.1" }` to the root `package.json` (not to the workspace manifests)
- [x] 2.2 Add the Node ≥ 26.12.1 prerequisite (and why: CVE-2026-111497) to `README.md`'s setup steps, noting `nvm install` reads `.nvmrc`

## 3. API guard

- [x] 3.1 In `api/src/app.js`, import the root `package.json` (`with { type: 'json' }`) and read the minimum from `engines.node`, accepting only `>=MAJOR.MINOR.PATCH` and throwing on any other form
- [x] 3.2 Add an exported numeric version-compare function; at module load, throw when `process.versions.node` is below the minimum, naming both versions
- [x] 3.3 Add `api/test/node-version.test.js`: the compare function on 26.12.0 (fails), 26.12.1, 26.100.0 and 27.0.0 (pass) against 26.12.1; the range reader rejects `^26.12.1` and `>=26`

## 4. Verify

- [x] 4.1 Run `npm test` and `npm run test:integration` on Node 26; both pass
- [x] 4.2 Run `nvm exec 25.6.1 node api/src/server.js`; confirm it exits with the error naming 25.6.1 and 26.12.1 and binds no port
- [x] 4.3 Run `nvm exec 25.6.1 npm install --dry-run` at the root; record whether npm reports the root `engines` mismatch (if not, note it: the guard is the enforcement)
- [x] 4.4 With the user's go-ahead, uninstall Node 25.6.1 from nvm (`nvm uninstall 25.6.1`) once 4.1–4.3 pass
- [x] 4.5 Rollback, if needed: revert the commit; localhost can stay on Node 26
