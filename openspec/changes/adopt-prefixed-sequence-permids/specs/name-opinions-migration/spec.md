## MODIFIED Requirements

### Requirement: permid is minted and reused as subject_permid
The script SHALL give each root `name_opinions` row the permid `TXN-<taxon_no>-<CC>`, where `taxon_no`
is the source `authorities` row's own `taxon_no` (not its authority survivor's), obtained in batches
from `register_permids('TXN', …)` (`prefixed-permids`). It SHALL store that permid as both `permid` and
`subject_permid` (a root record's subject is itself). The permid SHALL satisfy the `TXN` CHECK on both
columns.

#### Scenario: Self-referential root permid
- **WHEN** a root `name_opinions` row is inserted for source `taxon_no = 526272`
- **THEN** its `permid` and `subject_permid` are both `TXN-526272-71`, and `target_permid IS NULL`

#### Scenario: Absorbed taxon_no keeps its own name permid
- **WHEN** source rows with `taxon_no` 100 and 200 collapsed into one authority
- **THEN** their root `name_opinions` rows have permids numbered 100 and 200 respectively

#### Scenario: Distinct permid per row
- **WHEN** two source rows are migrated
- **THEN** they receive distinct `permid` values
