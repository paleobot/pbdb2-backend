## MODIFIED Requirements

### Requirement: Mint a sequence permid
The script SHALL mint the `permid` of each PBot reference it inserts from `mint_permids('REF', …)`
(`prefixed-permids`). The script SHALL NOT use the reference's `pbotID` as the permid or its number.

#### Scenario: permid assignment
- **WHEN** a PBot Reference with `pbotID = 'ec4353ee-467a-43cc-8383-524bd63987a7'` is inserted
- **THEN** the resulting `refs` row has a minted `REF` permid numbered from 10,000,000 up, and the JSONB still contains `legacyIDs.pbotID = 'ec4353ee-467a-43cc-8383-524bd63987a7'`
