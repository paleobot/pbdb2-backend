## RENAMED Requirements

- FROM: `### Requirement: Generate UUIDv7 permid`
- TO: `### Requirement: Mint a sequence permid`

## MODIFIED Requirements

### Requirement: Mint a sequence permid
The script SHALL mint the `permid` of each PBot reference it inserts from `mint_permids('REF', …)`
(`prefixed-permids`). The script SHALL NOT use the reference's `pbotID` as the permid or its number.

#### Scenario: permid assignment
- **WHEN** a PBot Reference with `pbotID = 'ec4353ee-467a-43cc-8383-524bd63987a7'` is inserted
- **THEN** the resulting `refs` row has a minted `REF` permid numbered from 1,000,000 up, and the JSONB still contains `legacyIDs.pbotID = 'ec4353ee-467a-43cc-8383-524bd63987a7'`

### Requirement: Idempotent upsert on legacyIDs.pbotID
The script SHALL make re-runs idempotent by keying on the reference's stable `legacyIDs.pbotID` rather than on `permid`. If a `refs` row already exists whose `reference->'legacyIDs'->>'pbotID'` matches the incoming PBot reference, the script SHALL update the `authorizer_person_id`, `enterer_person_id`, `reference`, and `removed` columns while preserving the existing `id` and `permid`. A new row (with a newly minted permid) SHALL be inserted only when no such existing row is found.

#### Scenario: First run
- **WHEN** no `refs` row has `reference->'legacyIDs'->>'pbotID'` equal to the incoming pbotID
- **THEN** a new row is inserted with a freshly minted `REF` permid

#### Scenario: Re-run preserves permid and id
- **WHEN** a `refs` row already exists with `reference->'legacyIDs'->>'pbotID'` equal to the incoming pbotID
- **THEN** that row is updated in place and its existing `permid` and `id` are preserved (no duplicate row, no new permid minted)

#### Scenario: Target table name
- **WHEN** the script executes INSERT/UPDATE statements
- **THEN** the target table is `refs` (not `"references"`)
