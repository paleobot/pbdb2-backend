## Why

`pbot-schemas` finds the reference a schema cites by its PBot `pbotID` in `refs.legacyIDs.pbotID`. A PBot reference that carries a `pbdbid` is never written under its `pbotID`: `pbot-refs` skips it, because it already exists in `refs` as the Classic ref with that `reference_no`. A schema citing such a reference therefore can't be resolved. It is dropped as its primary reference, or loses the citation as an additional one, and the runner fails the step.

This first happened on 2026-11-10. With a PBot token for an account that sees private records, two test schemas ("Schema-ddm-09-12a" and "-b") cite "Ref-ddm-08-25a" (`pbdbid` 68934). The cause is not specific to private or test data: any PBot schema can cite a Classic-linked reference. PBot will keep running after pbdb2 goes live, and the migration will be re-run against it, so the step has to handle this case rather than rely on it not occurring.

## What Changes

- The Schema query also fetches `pbdbid` and `title` on each cited Reference.
- Each cited reference, primary or additional, is resolved by `legacyIDs.pbotID` first. When that finds nothing and the PBot reference has a non-blank `pbdbid`, it is resolved by `legacyIDs.oldpbdbID` = the trimmed `pbdbid`. This is the same link `pbot-refs` trusts when it skips the reference.
- A reference unresolved both ways is treated as today (warning; primary → schema skipped, additional → citation skipped). The warning names the `pbdbid` when there is one.
- Each resolution through `pbdbid` is logged with both titles, PBot's and the Classic ref's, and counted in the summary, so a stub `pbdbid` that links to an unrelated Classic ref can be reviewed after a run.
- Nothing is written to Classic `refs` rows: `legacyIDs.pbotID` keeps meaning "this row came from PBot".

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `pbot-schema-migration`: the Schema fetch adds `pbdbid` and `title` on cited References; reference resolution falls back to `pbdbid` → `oldpbdbID`; logging adds the per-resolution line and the `pbdbid` count.

## Impact

- **Source → target:** PBot GraphQL `Schema.references.Reference` (`pbotID`, `pbdbid`, `title`) → PostgreSQL `schemas.reference_id` and `additional_schema_refs.reference_id`, looked up in `refs` by `reference->'legacyIDs'->>'pbotID'` or `->>'oldpbdbID'`. No type mapping changes.
- **Code:** `migrations/src/pbot-schemas-migration/migrate-pbot-schemas.js` and a new unit test. `pbot-refs` is unchanged: it still skips references with a `pbdbid`. The runner is unchanged: its summary parser reads only the Schemas, Characters and States lines.
- **Data integrity:**
  - With today's public data no cited reference has a `pbdbid`, so the output is unchanged: 8 schemas, 1 additional schema ref, 336 characters, 1,325 states.
  - With a token that sees private records, the two test schemas and their characters and states now load, instead of being dropped and leaving 8 characters and 1 state orphaned. The user will remove that test data in PBot; until then it is a useful live test.
  - **Risk:** a stub `pbdbid` resolves without error to whatever Classic ref has that number (68934 here, an unrelated paper). The migration can't detect this. The per-resolution log with both titles is the mitigation.
- **Anomalies:** none from the PBDB anomaly report apply. The relevant PBot data issue is stub `pbdbid` values on test references.
- **Not in scope:** whether private PBot records should be migrated at all (the user is asking others; their likely answer is yes), and which account's token the migration uses.
