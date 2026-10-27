## MODIFIED Requirements

### Requirement: Round-trip mode verifies split and merge on stored data
With `--round-trip`, for every head row of an entity — every row, for an unversioned entity — the script SHALL additionally:
1. build the stored parts (jsonb, codec-selected columns, child rows);
2. `merge` them and validate the result against `out`;
3. remove `readOnly` properties and `split` the result.

It SHALL count a violation when the split jsonb or any column or child value differs from the stored value after codec normalization.

Where an entity's codecs declare lookup sources, the script SHALL pass a codec context to `merge` and `split`.
Sources in the `dictionaries` schema SHALL be read once for the run and reused across batches. For every other
source the script SHALL select per batch, from the key values that batch holds, when `codecKeyColumns` names
the columns those keys come from, so that no entity table is read more broadly than the batch references; and
SHALL pre-load the source once for the run when it does not.

Whether `refs` is pre-loaded depends on the entity, not the table. For collection and schema it is pre-loaded:
each source's `additionalReferences` is annotated `{ table, codec: "referenceLinks" }`, a child-table codec
that reads `refs`, so `codecKeyColumns` leaves `refs` out even though `primaryReference` (`referencePermid`)
names `reference_id`. The refs a batch cites are split between the parent's `reference_id` and the child rows.
Reading it whole is also the cheaper choice there: the lookup is 93,944 rows of `(bigint, text)`, while
selecting it per batch would issue 56 queries across a collections audit. Schema pre-loads it for the same
reason, the annotation, although its few rows would make either choice cheap. For authority it is selected per batch: `referencePermid` is annotated
with `column: "reference_id"`, so `codecKeyColumns` names the column the batch's keys come from.

#### Scenario: Stable round trip
- **WHEN** `--round-trip` runs on a freshly migrated database
- **THEN** every head collection, specimen, reference, authority, schema, character and state, and every person, round-trips with zero differences

#### Scenario: Codec defect detected
- **WHEN** a codec swaps latitude and longitude on merge
- **THEN** the round trip reports differing `location` values and the script exits non-zero

#### Scenario: Person round trip rebuilds its column-backed fields
- **WHEN** `--round-trip` runs on person
- **THEN** each row's `role`, `authorizer`, `active`, `totalHours` and `permid` are rebuilt from the columns, validated against `out`, and split back to the values stored

#### Scenario: Collection round trip rebuilds its citations as permids
- **WHEN** `--round-trip` runs on collection
- **THEN** each row's `primaryReference` and `additionalReferences` are rebuilt as reference links, validated against `out`, and split back to the same `collections.reference_id` and the same `additional_collection_refs` rows that are stored, a row repeating the primary included

#### Scenario: Entity source is selected per batch
- **WHEN** a person batch of 5,000 rows is round-tripped
- **THEN** the `persons` lookup reads only the ids that batch references

#### Scenario: Dictionary source is read once for the run
- **WHEN** an entity is round-tripped across several batches
- **THEN** `dictionaries.roles` is read once and reused, not re-read per batch

#### Scenario: Unaddressable source is read once for the run
- **WHEN** 275,554 collections are round-tripped in 5,000-row batches
- **THEN** `refs` is read once for the run and reused, not once per batch, because `referenceLinks`, a child-table codec reading `refs`, leaves `codecKeyColumns` with no key column for it

#### Scenario: Reference round trip needs no codec context
- **WHEN** `--round-trip` runs on reference
- **THEN** each head row's `permid` is rebuilt from its column, the payload validates against `out`, and the split jsonb equals the stored jsonb; no codec source is loaded, because the reference source declares none

#### Scenario: Authority round trip rebuilds its reference as a permid
- **WHEN** `--round-trip` runs on authority
- **THEN** each head row's `permid` and `reference` are rebuilt from their columns, the payload validates against `out`, and splitting it back yields the stored jsonb and the same `reference_id`

#### Scenario: Authority batches select refs by id
- **WHEN** a 5,000-row batch of authorities is round-tripped
- **THEN** `refs` is read by `WHERE id = ANY($1)` restricted to the `reference_id`s that batch holds, from lineage heads only

#### Scenario: Schema round trip rebuilds its citations as permids
- **WHEN** `--round-trip` runs on schema
- **THEN** each head row's `permid`, `primaryReference` and `additionalReferences` are rebuilt from `schemas.permid`, `schemas.reference_id` and the `additional_schema_refs` rows keyed by `schema_id`, the payload validates against `out`, and splitting it back yields the stored jsonb, the same `reference_id` and the same child rows in `id` order

#### Scenario: State round trip rebuilds quantitative
- **WHEN** `--round-trip` runs on state
- **THEN** each head row's `permid` and `quantitative` are rebuilt from their columns, the payload validates against `out`, and splitting it back yields the stored jsonb and the same `quantitative`; no codec source is loaded, because neither the character nor the state source declares one
