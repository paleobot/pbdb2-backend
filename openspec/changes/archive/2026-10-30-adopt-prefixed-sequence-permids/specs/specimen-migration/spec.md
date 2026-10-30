## RENAMED Requirements

- FROM: `### Requirement: Generate a UUIDv7 permid per row`
- TO: `### Requirement: Give each row its Classic specimen number as permid`

## MODIFIED Requirements

### Requirement: Give each row its Classic specimen number as permid
The script SHALL give each source row the permid `SPM-<specimen_no>-<CC>`, obtained in batches from
`register_permids('SPM', …)` (`prefixed-permids`), satisfying the target table's permid CHECK. Each
source row SHALL receive exactly one permid.

#### Scenario: Permid satisfies the permid check
- **WHEN** Classic specimen 1 is inserted
- **THEN** its `permid` is `SPM-1-04`, and the table's prefix and check-digit CHECK holds
