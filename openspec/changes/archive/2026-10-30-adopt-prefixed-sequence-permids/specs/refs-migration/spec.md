## MODIFIED Requirements

### Requirement: Generate permid UUID
The script SHALL give each reference the permid `REF-<reference_no>-<CC>`, obtained in batches from
`register_permids('REF', …)` (`prefixed-permids`), and store it as the `permid` column. On idempotent
re-runs, the `permid` MUST NOT be overwritten, and the script SHALL register only the permids of rows
it newly inserts.

#### Scenario: First insertion
- **WHEN** reference 12345 is inserted for the first time
- **THEN** its `permid` is `REF-12345-15` and `permids` holds that value

#### Scenario: Idempotent re-run preserves permid
- **WHEN** the script is re-run and a reference with the same `id` already exists
- **THEN** the existing `permid` value is preserved (not overwritten by the upsert), and no second
  registration of it is attempted

### Requirement: Batched upsert
The script SHALL insert rows in batches (e.g. 500 per batch) using multi-value INSERT into the `refs` table with `ON CONFLICT (id) DO UPDATE SET ...`. The `permid` column MUST be excluded from the UPDATE SET to preserve permids on re-runs.

#### Scenario: Batch processing
- **WHEN** 93,863 rows are migrated
- **THEN** rows are inserted in batches rather than individually

#### Scenario: Idempotent re-run
- **WHEN** the script is re-run against a populated `refs` table
- **THEN** existing rows are updated (except `permid`) and no duplicates are created

#### Scenario: Target table name
- **WHEN** the script executes INSERT statements
- **THEN** the target table is `refs` (not `"references"`)
