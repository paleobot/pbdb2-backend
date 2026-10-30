## MODIFIED Requirements

### Requirement: Generate a fresh permid per collection
The script SHALL give each inserted collection the permid `COL-<collection_no>-<CC>`, obtained in
batches from `register_permids('COL', …)` (`prefixed-permids`), and insert rows as single versions
(`succeeded_by_id IS NULL`).

#### Scenario: Permid from the Classic number
- **WHEN** Classic collection 12345 is inserted
- **THEN** its `permid` is `COL-12345-70`, its `permid_no` is 12345, and it has no
  `preceded_by_id`/`succeeded_by_id`
