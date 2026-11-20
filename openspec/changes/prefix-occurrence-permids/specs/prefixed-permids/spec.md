## RENAMED Requirements

- FROM: `### Requirement: New numbers come from one sequence per prefix, starting at 1,000,000`
- TO: `### Requirement: New numbers come from one sequence per prefix, starting at 10,000,000`

## MODIFIED Requirements

### Requirement: Each permid space has one prefix
Each table that creates entities SHALL have exactly one prefix:

| Table | Prefix | | Table | Prefix |
|---|---|---|---|---|
| `refs` | `REF` | | `name_opinions` | `TXN` |
| `persons` | `PRS` | | `assignment_opinions` | `AOP` |
| `collections` | `COL` | | `validity_opinions` | `VOP` |
| `specimens` | `SPM` | | `taxon_annotations` | `TAN` |
| `intervals` | `INT` | | `schemas` | `SCH` |
| `timescales` | `TSC` | | `characters` | `CHR` |
| `authorities` | `AUT` | | `states` | `STA` |
| `occurrences` | `OCC` | | | |

`REF`, `PRS`, `COL`, `SPM`, `INT`, `TSC` and `OCC` are the PBDB Classic data service's identifier
prefixes for the same record types, upper-cased. `TXN` reuses Classic's taxon prefix so that a
taxon, whose permid is its root name opinion's, reads as a taxon; `TXN-<n>` is not promised to
equal Classic `txn:<n>`. The derived taxa tables have no prefix of their own, because their rows
have no identity of their own, and no prefix is reserved.

#### Scenario: Unknown prefix is refused
- **WHEN** `mint_permids('XYZ', 1)` is called
- **THEN** it raises an error and registers nothing

#### Scenario: The retired names are unknown prefixes
- **WHEN** `mint_permids('NOP', 1)` or `mint_permids('TXL', 1)` is called
- **THEN** it raises an error and registers nothing

#### Scenario: Occurrences have their own prefix
- **WHEN** `mint_permids('OCC', 1)` is the first mint for `OCC` in a database built from the DDL
- **THEN** it returns `{OCC-10000000-29}`

### Requirement: Every permid column is text, checked, and a foreign key to the registry
Every column that holds a permid, whether the row's own or a reference to another row's, SHALL be
`text COLLATE "C"`, the registry's collation, SHALL carry an FK to `permids(permid)`, and SHALL carry
a CHECK that the value has the column's prefix, the format, and valid check digits. The CHECK SHALL
call one SQL function that validates the format (for example `permid_is_valid(value, 'TXN')`). That
function SHALL be written in `LANGUAGE sql` and SHALL NOT be `STRICT`, so that PostgreSQL can inline
it into each CHECK. It SHALL return NULL for a NULL value and SHALL raise an error for an unknown
prefix. This applies to:

- the own `permid` of every table in "Each permid space has one prefix";
- `name_opinions.subject_permid` and `target_permid`, `assignment_opinions.subject_permid` and
  `containing_permid`, `validity_opinions.subject_permid`, `taxon_annotations.subject_permid`,
  `homonyms.permid`, `specimens.name_opinions_permid` and `occurrences.taxon_permid`, all `TXN`;
- every permid column of the derived tables `taxa_linnaean`, `taxa_clades`, `taxa_attachments`,
  `taxa` and `cycle_cuts`, all `TXN`.

`homonyms.homonym_group_id` is not a permid. It SHALL stay a `uuid` with its version-7 CHECK.

#### Scenario: Wrong prefix in a reference column
- **WHEN** an `assignment_opinions` row is inserted whose `subject_permid` is a valid `AUT-…` permid
- **THEN** PostgreSQL rejects the write with a check-constraint violation

#### Scenario: Valid but unregistered permid
- **WHEN** a `name_opinions` row is inserted whose `target_permid` passes the CHECK but has no
  `permids` row
- **THEN** PostgreSQL rejects the write with a foreign-key violation

#### Scenario: Bad check digits
- **WHEN** a `refs` row is inserted with permid `REF-12345-16`
- **THEN** PostgreSQL rejects the write with a check-constraint violation

#### Scenario: The homonym group id stays a UUID
- **WHEN** the DDL is applied
- **THEN** `homonyms.homonym_group_id` is `uuid` with the version-7 CHECK, and `homonyms.permid` is
  `text COLLATE "C"` with the `TXN` CHECK and an FK to `permids`

#### Scenario: An occurrence's taxon is a TXN permid
- **WHEN** an `occurrences` row is inserted whose `taxon_permid` is a valid, registered `COL-…` permid
- **THEN** PostgreSQL rejects the write with a check-constraint violation

#### Scenario: Every permid column compares bytewise
- **WHEN** the DDL is applied and `information_schema.columns` is read for the public `text` columns
  whose names end in `permid`
- **THEN** every one has `collation_name = 'C'`

#### Scenario: No permid column is a uuid
- **WHEN** the DDL is applied and `information_schema.columns` is read for the public columns whose
  names end in `permid`
- **THEN** none has data type `uuid`

#### Scenario: The CHECK function can be inlined
- **WHEN** the DDL is applied and `pg_proc` is read for `permid_is_valid`
- **THEN** its language is `sql` and `proisstrict` is false

#### Scenario: The CHECK function keeps its results
- **WHEN** `permid_is_valid` is called with `COL-12345-70` and `'COL'`, with `COL-012345-70` and
  `'COL'`, with `NULL` and `'TXN'`, and with `TXL-1-00` and `'TXL'`
- **THEN** it returns true, false and NULL for the first three, and raises `unknown permid prefix`
  for the last

### Requirement: Legacy numbers are registered, not minted
The schema SHALL define `register_permids(prefix text, numbers bigint[]) RETURNS text[]`, which
formats each number as a permid under `prefix`, inserts each into `permids`, and returns the permids
in input order. It SHALL raise an error, and register nothing from that call, when:
- the prefix is unknown or reserved;
- a number is less than 1 or at least 10,000,000 (the sequence floor), because such a permid could
  collide with a minted one;
- a number appears twice in the input;
- a resulting permid is already registered.

A script that re-runs over existing rows SHALL register only the permids of rows it newly inserts.

#### Scenario: Registering Classic references
- **WHEN** `register_permids('REF', ARRAY[12345, 96229])` is called on an empty registry
- **THEN** it returns `{REF-12345-15, REF-96229-78}`, and both are in `permids`

#### Scenario: A Classic number above one million is registered
- **WHEN** `register_permids('OCC', ARRAY[2078017])` is called on an empty registry
- **THEN** it returns `{OCC-2078017-88}`

#### Scenario: A legacy number registered twice fails
- **WHEN** two different source rows would both register `AUT-526271-06`
- **THEN** the second registration raises an error, instead of the second row silently becoming
  a version of the first

#### Scenario: A legacy number at the floor is refused
- **WHEN** `register_permids('COL', ARRAY[10000000])` is called
- **THEN** it raises an error

### Requirement: New numbers come from one sequence per prefix, starting at 10,000,000
The schema SHALL define one sequence per mintable prefix, each starting at 10,000,000. The DDL itself
sets the start, so a database built from the DDL needs no further setup before minting. The schema
SHALL define `mint_permids(prefix text, n integer) RETURNS text[]`, which takes `n` values from that
prefix's sequence, formats and registers each, and returns them in sequence order.

10,000,000 is above every Classic number that becomes a permid (the largest is `occurrence_no`,
2,078,017), so minted and legacy permids cannot collide, and a minted permid is visibly longer than
any legacy one. One floor serves every prefix.

#### Scenario: First minted schema permid
- **WHEN** `mint_permids('SCH', 1)` is the first mint for `SCH` in a database built from the DDL
- **THEN** it returns `{SCH-10000000-57}`

#### Scenario: A batch is minted in one call
- **WHEN** `mint_permids('AOP', 5000)` is called
- **THEN** it returns 5,000 distinct registered permids in increasing numeric order

### Requirement: Each table's numbers have one source
Each table's permid numbers SHALL come from exactly one of these sources:

| Table | Number |
|---|---|
| `refs` | Classic `reference_no`; PBot-only references use the sequence |
| `persons` | Classic `person_no`; PBot-only persons use the sequence |
| `collections` | Classic `collection_no` |
| `specimens` | Classic `specimen_no` |
| `authorities` | the survivor's Classic `taxon_no`, which is the lowest `taxon_no` the authority absorbed |
| `name_opinions` | root rows migrated from a Classic `authorities` row: that row's own `taxon_no`. Every other row (concept, misspelling and backfilled rows, lineage rows): the sequence |
| `occurrences` | rows migrated from a Classic `occurrences` row: its `occurrence_no`. Rows migrated from a Classic `reidentifications` row, and new rows: the sequence |
| `assignment_opinions`, `validity_opinions`, `taxon_annotations` | the sequence |
| `schemas`, `characters`, `states` | the sequence |
| sentinel rows, and any row with no Classic row | the sequence |

Classic `opinion_no` SHALL NOT be used as a permid number, because one Classic opinion can produce
more than one `name_opinions` row. Classic `reid_no` SHALL NOT be used as a permid number, because
it overlaps `occurrence_no`; it stays in the occurrence payload's `legacyIDs.oldpbdbReidID`. An
authority's absorbed `taxon_no`s other than the survivor's SHALL remain in
`legacyIDs.oldpbdbIDs`.

#### Scenario: A taxon's name and authority share a number
- **WHEN** Classic `taxon_no` 526,271 is migrated as an authority survivor and as a root name opinion
- **THEN** the authority's permid is `AUT-526271-06` and the root name opinion's permid is
  `TXN-526271-74`

#### Scenario: Merged authority
- **WHEN** Classic `taxon_no`s 100, 200 and 300 collapse into one authority
- **THEN** its permid's number is 100, and `authority.legacyIDs.oldpbdbIDs` is `['100', '200', '300']`

#### Scenario: An occurrence keeps its Classic number
- **WHEN** Classic occurrence 12345 is migrated
- **THEN** its permid is `OCC-12345-35`

#### Scenario: A reidentification is numbered from the sequence
- **WHEN** Classic reidentification 12345 is migrated
- **THEN** its permid comes from `mint_permids('OCC', …)`, its number is at least 10,000,000, and
  its payload's `legacyIDs.oldpbdbReidID` is `'12345'`

#### Scenario: Legacy permids are reproducible
- **WHEN** the database is rebuilt twice from the same MariaDB dump
- **THEN** every legacy-numbered permid is the same in both builds

### Requirement: Names-as-spelled are identified by their root name opinion's permid
A name-as-spelled SHALL have no permid space of its own. A root `name_opinions` row SHALL store its
own `TXN` permid as both `permid` and `subject_permid`. That permid is the name's identity:
`taxa_linnaean.permid`, `taxa_clades.permid` and the derived `original_permid`,
`accepted_spelling_permid` and `concept_permid` columns all hold `TXN` permids.

#### Scenario: A taxon is cited by its name permid
- **WHEN** a client reads a taxon
- **THEN** its `permid` has the prefix `TXN`

#### Scenario: A non-root name opinion's permid is not a taxon
- **WHEN** the `opinions` migration mints a permid for a spelling or synonymy `name_opinions` row
- **THEN** the permid has the prefix `TXN` and a number of at least 10,000,000, and no row of
  `taxa_linnaean` or `taxa` has that permid
