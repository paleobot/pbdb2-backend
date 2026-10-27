## MODIFIED Requirements

### Requirement: Mint a permid for every person
The script SHALL give every person row it inserts the permid `PRS-<person_no>-<CC>`, obtained in
batches from `register_permids('PRS', …)` (`prefixed-permids`). The number SHALL be the Classic
`person_no` and nothing else: not `legacyIDs.pbotID`, the person's email, or any other source value.

The permid is a flat column on `persons`, not a property of the `person` JSONB. It joins — and does not
replace — the identifiers the row already carries: `id` (seeded from `person_no`) remains the key every
`authorizer_person_id` and `enterer_person_id` in the schema references, and `legacyIDs.oldpbdbID` remains
the record of where the row came from.

#### Scenario: Every migrated person has a permid
- **WHEN** the migration completes
- **THEN** all 1,304 rows in `persons` have a non-NULL `permid` with the prefix `PRS` and valid check digits

#### Scenario: Permids are distinct
- **WHEN** the migration completes
- **THEN** the number of distinct `permid` values in `persons` equals the number of rows

#### Scenario: Permid carries the Classic number
- **WHEN** a person with `person_no = 42` is migrated
- **THEN** the row's `permid` is `PRS-42-70`, and `person->legacyIDs->>'oldpbdbID'` is still `'42'`
