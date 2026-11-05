# node-runtime Specification

## Purpose
Fix the minimum Node.js version the repository requires (set by CVE-2026-111497), the one place it is
declared (the root `package.json`'s `engines.node`), the release line named for version managers
(`.nvmrc`), and the API's refusal to load below the minimum.

## Requirements
### Requirement: The repository declares its minimum Node.js version
The root `package.json` SHALL declare the minimum Node.js version as `"engines": { "node": ">=26.12.1" }`.
This is the only place the minimum is written. The workspace manifests (`api/package.json`,
`migrations/package.json`) SHALL NOT declare their own `engines`. The README SHALL state the same minimum as
a prerequisite.

The minimum is set by CVE-2026-111497: a version below 26.12.1 is not to be run.

#### Scenario: Installing on an older Node
- **WHEN** `npm install` is run at the repository root on Node 25.6.1
- **THEN** npm reports that the project requires Node `>=26.12.1`

#### Scenario: One declaration
- **WHEN** the three `package.json` files are read
- **THEN** only the root one has an `engines` field

### Requirement: The repository names its Node.js major version for version managers
The repository root SHALL hold an `.nvmrc` whose content is the major version alone, `26`. It names the
release line to install, not the minimum: the patch floor stays in `engines.node`, so `.nvmrc` changes only
when the major version does.

#### Scenario: Installing Node with nvm
- **WHEN** `nvm install` is run with no argument at the repository root
- **THEN** nvm installs the latest Node 26 release

#### Scenario: A patch-level floor raise
- **WHEN** `engines.node` is raised from `>=26.12.1` to `>=26.13.0`
- **THEN** `.nvmrc` is unchanged

### Requirement: The API refuses to load below the minimum Node.js version
Importing `api/src/app.js` SHALL throw when the running Node.js version (`process.versions.node`) is below
the minimum in the root `package.json`'s `engines.node`. The guard SHALL read that value; it SHALL NOT hold
its own copy of the version. The error message SHALL name both the running version and the required
minimum. The check SHALL run when the module loads, before `build()` is called, so that the server entry,
`npm start` and every test suite that imports `app.js` all fail on an older Node.

The guard SHALL accept `engines.node` only in the form `>=MAJOR.MINOR.PATCH`. Any other form SHALL make the
import throw, naming the value it could not read.

Versions SHALL be compared numerically by major, then minor, then patch.

#### Scenario: Starting the server on Node 25
- **WHEN** `node src/server.js` is run on Node 25.6.1
- **THEN** it exits with an error naming `25.6.1` and `26.12.1`, and no port is bound

#### Scenario: An older patch of Node 26
- **WHEN** the running version is 26.12.0 and the minimum is 26.12.1
- **THEN** the check fails

#### Scenario: The minimum itself
- **WHEN** the running version is 26.12.1 and the minimum is 26.12.1
- **THEN** the check passes

#### Scenario: Numeric, not string, comparison
- **WHEN** the running version is 26.100.0 and the minimum is 26.12.1
- **THEN** the check passes

#### Scenario: A later major
- **WHEN** the running version is 27.0.0 and the minimum is 26.12.1
- **THEN** the check passes

#### Scenario: Raising the floor
- **WHEN** `engines.node` is changed to `>=26.13.0` and nothing else is edited
- **THEN** the guard rejects 26.12.1

#### Scenario: An unsupported range form
- **WHEN** `engines.node` is `^26.12.1` or `>=26`
- **THEN** importing `app.js` throws, naming that value
