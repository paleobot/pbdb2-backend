## MODIFIED Requirements

### Requirement: Fetch Schemas from PBot GraphQL API
The script SHALL fetch all Schema nodes from `https://pbot.paleobiodb.org/graphql` using a POST request with a Bearer token from the `PBOT_TOKEN` environment variable. The query SHALL retrieve schema scalar fields (`pbotID`, `title`, `year`, `purpose`, `acknowledgments`), `partsPreserved` and `notableFeatures` (as relationship nodes or string values), `references` (with `order` and Reference `pbotID`, `pbdbid` and `title`), `authoredBy` (with `order` and Person `given`, `surname`), and `enteredBy` (with `type`, `timestamp`, and Person `pbotID`).

#### Scenario: Successful fetch
- **WHEN** the script sends the GraphQL query with a valid Bearer token
- **THEN** all Schema nodes are returned with their full field set and relationships, and each cited Reference carries its `pbotID`, `pbdbid` and `title`

#### Scenario: API unreachable
- **WHEN** the GraphQL endpoint is unreachable or returns an error
- **THEN** the script logs the error and exits with a non-zero exit code

### Requirement: Resolve schema references by order
The script SHALL resolve all references associated with each Schema. References SHALL be sorted by their `order` value ascending. The reference with the lowest order SHALL become the `schemas.reference_id` column value. All remaining references SHALL be inserted as rows in `additional_schema_refs`.

Each reference, primary or additional, SHALL be resolved to a PostgreSQL `refs.id` as follows:
1. By its PBot `pbotID`, looked up in the `refs` table via `reference->'legacyIDs'->>'pbotID'`.
2. When that finds no row and the PBot reference's `pbdbid`, trimmed, is non-blank, by that trimmed `pbdbid`, looked up via `reference->'legacyIDs'->>'oldpbdbID'`. This is the Classic ref that `pbot-refs` skipped the PBot reference in favour of.

The script SHALL NOT write to any `refs` row while resolving references.

#### Scenario: Schema with one reference
- **WHEN** a PBot Schema has one reference with `order = 1` and `pbotID = 'ref-aaa'`
- **THEN** `schemas.reference_id` is set to the `refs.id` matching `ref-aaa`, and no rows are added to `additional_schema_refs`

#### Scenario: Schema with multiple references
- **WHEN** a PBot Schema has references with orders `[3, 1, 2]` and pbotIDs `['ref-ccc', 'ref-aaa', 'ref-bbb']`
- **THEN** `schemas.reference_id` is set to the `refs.id` matching `ref-aaa` (lowest order), and `additional_schema_refs` gets rows for `ref-bbb` and `ref-ccc`

#### Scenario: Primary reference resolved through pbdbid
- **WHEN** a Schema's primary reference has `pbotID = 'de299345-…'`, no `refs` row has that `legacyIDs.pbotID`, and the reference has `pbdbid = '68934'`
- **THEN** `schemas.reference_id` is set to the `refs.id` whose `legacyIDs.oldpbdbID` is `'68934'`, the schema is inserted, and the resolution is logged and counted

#### Scenario: Additional reference resolved through pbdbid
- **WHEN** a Schema's additional reference is not found by its `pbotID` and has `pbdbid = ' 43141 '`
- **THEN** an `additional_schema_refs` row is inserted for the `refs.id` whose `legacyIDs.oldpbdbID` is `'43141'`

#### Scenario: pbotID takes precedence
- **WHEN** a reference's `pbotID` matches a `refs` row and the reference also has a `pbdbid`
- **THEN** the row matched by `pbotID` is used and the `pbdbid` is not looked up

#### Scenario: Reference not found in refs table
- **WHEN** a Schema's reference is found neither by its `pbotID` nor, where it has one, by its `pbdbid`
- **THEN** a warning is logged that names the `pbotID` and, when non-blank, the `pbdbid`. If the unresolved reference was the primary (lowest order), the schema is skipped; otherwise only that citation is skipped.

### Requirement: Verification and logging
The script SHALL log: start time, counts fetched from PBot (schemas, characters, states), counts inserted into PostgreSQL for each table and level, counts of orphans detected, counts of skipped records (missing enterer, missing reference), the number of primary and additional references resolved through `pbdbid`, and end time with elapsed duration.

For each reference resolved through `pbdbid`, the script SHALL log the schema's `pbotID`, the reference's `pbotID`, the `pbdbid`, the PBot reference's title and the title of the Classic `refs` row it resolved to, so that a stub or mistaken `pbdbid` can be found by reading the log.

The summary SHALL include the line `Refs via pbdbid: primary=<n>, additional=<m>`, after the `Additional refs:` line. The `Schemas:`, `Characters:` and `States:` summary lines SHALL keep their format, which the runner parses.

#### Scenario: Successful run logging
- **WHEN** the migration completes successfully
- **THEN** the log includes fetch counts, insertion counts per table and level, orphan counts, skip counts, the `Refs via pbdbid` counts, and elapsed time

#### Scenario: Orphan summary
- **WHEN** orphan characters or states are detected
- **THEN** the script logs each orphan's pbotID and unresolved parent pbotID, plus a summary count

#### Scenario: A pbdbid resolution shows both titles
- **WHEN** a schema's reference titled "Ref-ddm-08-25a" resolves through `pbdbid = '68934'` to a Classic ref titled "Macroevolutionary dynamics and historical biogeography…"
- **THEN** the log line for that resolution contains the schema `pbotID`, the reference `pbotID`, `68934` and both titles

#### Scenario: No pbdbid resolutions
- **WHEN** every cited reference resolves by `pbotID`
- **THEN** the summary reads `Refs via pbdbid: primary=0, additional=0` and no resolution lines are logged
