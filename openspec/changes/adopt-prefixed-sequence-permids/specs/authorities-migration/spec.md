## MODIFIED Requirements

### Requirement: Generate fresh permid per inserted authority
The script SHALL give each inserted authority the permid `AUT-<taxon_no>-<CC>`, where `taxon_no` is
the survivor's (the lowest `taxon_no` that collapsed into the row), obtained in batches from
`register_permids('AUT', …)` (`prefixed-permids`), and store it as the `permid` column. The other
absorbed `taxon_no`s stay in `legacyIDs.oldpbdbIDs` and are not permids.

#### Scenario: Permid from the survivor's taxon_no
- **WHEN** a survivor row with `taxon_no = 526272` is inserted
- **THEN** its `permid` is `AUT-526272-03`, distinct from all other rows in the table, and the
  `authorities` table's permid CHECK accepts it

#### Scenario: Merged authority keeps the lowest number
- **WHEN** `taxon_no`s 100, 200 and 300 collapse into one survivor
- **THEN** its `permid` has number 100, and `authority.legacyIDs.oldpbdbIDs` is `['100', '200', '300']`
