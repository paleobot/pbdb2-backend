## RENAMED Requirements

- FROM: `### Requirement: Generate UUIDv7 permid`
- TO: `### Requirement: Mint a sequence permid`

## MODIFIED Requirements

### Requirement: Mint a sequence permid
The script SHALL mint the `permid` of each PBot Schema, Character, and State from
`mint_permids('SCH', …)`, `mint_permids('CHR', …)` and `mint_permids('STA', …)` respectively
(`prefixed-permids`). The script SHALL NOT use the entity's `pbotID` as the permid or its number. The
PBot `pbotID` SHALL remain in the entity JSONB at `legacyIDs.pbotID`.

#### Scenario: Schema permid assignment
- **WHEN** a PBot Schema with `pbotID = 'abc-123'` is the first schema inserted
- **THEN** the resulting `schemas` row has `permid` `SCH-1000000-26` (not `abc-123`), and the `schema` JSONB contains `legacyIDs.pbotID = 'abc-123'`

#### Scenario: Character permid assignment
- **WHEN** a PBot Character with `pbotID = 'char-bbb'` is inserted
- **THEN** the resulting `characters` row has a minted `CHR` `permid`, and the `character` JSONB contains `legacyIDs.pbotID = 'char-bbb'`

#### Scenario: State permid assignment
- **WHEN** a PBot State with `pbotID = 'state-ccc'` is inserted
- **THEN** the resulting `states` row has a minted `STA` `permid`, and the `state` JSONB contains `legacyIDs.pbotID = 'state-ccc'`

#### Scenario: Parent resolution unaffected
- **WHEN** characters and states are inserted level-by-level using parent pbotID-to-id maps
- **THEN** parent resolution continues to work because it keys on the entity's pbotID (from the fetched PBot data / `legacyIDs.pbotID`), not on `permid`
