## REMOVED Requirements

### Requirement: Permids are generated as UUIDv7
**Reason**: Permids are now prefixed sequence codes (`prefixed-permids`).
**Migration**: Get permids from `register_permids` or `mint_permids`; see `prefixed-permids`, "Migration scripts get permids from the database".

### Requirement: Shared UUIDv7 generation helper
**Reason**: Nothing mints UUID permids any more. `src/lib/uuidv7.js` and the `uuid` dependency are removed.
**Migration**: The SQL functions in `prefixed-permids` replace the helper as the single place permids are made.

### Requirement: External legacy identifiers preserved in legacyIDs
**Reason**: Restated in `prefixed-permids` ("Migration scripts get permids from the database") and in each PBot migration spec, which keep `legacyIDs.pbotID`.
**Migration**: None. Behaviour is unchanged.

### Requirement: Database enforces UUIDv7 version on in-scope permid columns
**Reason**: Permid columns are `text`. The version CHECK becomes a prefix, format and check-digit CHECK plus an FK to the `permids` registry, on reference columns as well as minting ones.
**Migration**: See `prefixed-permids`, "Every permid column is text, checked, and a foreign key to the registry". `homonyms.homonym_group_id` keeps its version-7 CHECK.

### Requirement: Timescales and intervals excluded from scope
**Reason**: `intervals` and `timescales` now have prefixes (`INT`, `TSC`) and the same checks as every other permid column.
**Migration**: None. Both tables are empty.

### Requirement: Minted permid on an unversioned table is UNIQUE
**Reason**: Restated in `prefixed-permids`, "Each table carries its permid's number for ordering", together with the per-head unique index on versioned tables.
**Migration**: None. `persons.permid` stays `UNIQUE` and `persons` stays unversioned.

### Requirement: UUIDv7 time-ordering is accepted for persons
**Reason**: Person permids are Classic `person_no`s or sequence numbers. They are ordered and enumerable by design, which the committee's citeable-identifier requirement accepts.
**Migration**: None.
