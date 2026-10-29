## RENAMED Requirements

- FROM: `### Requirement: permid is a freshly minted uuidv7`
- TO: `### Requirement: permid is minted from the TXN sequence`

## MODIFIED Requirements

### Requirement: permid is minted from the TXN sequence
The script SHALL mint the `permid` of each `name_opinions` row it inserts from `mint_permids('TXN', …)` (`prefixed-permids`), in batches. Classic `opinion_no` SHALL NOT be used as the number. Each classic opinion is its own opinion identity; the script SHALL NOT collapse multiple in-scope opinions on the same taxon into one permid.

#### Scenario: Minted permid accepted
- **WHEN** a `name_opinions` row is inserted with a permid from `mint_permids('TXN', …)`
- **THEN** it satisfies the `TXN` CHECK and the FK to `permids`, and its number is at least 1,000,000

#### Scenario: Multiple synonymies on one taxon are separate rows
- **WHEN** a taxon has two in-scope synonymy original-spelling opinions from different references
- **THEN** two `name_opinions` rows are inserted with distinct `permid` values
