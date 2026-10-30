# prefixed-permids Specification

## Purpose
Define pbdb2's permanent identifiers: prefixed, check-digited text permids of the form `<PREFIX>-<number>-<CC>`, where the prefix names the permid space, the number is a legacy Classic/PBot number or a value from that prefix's sequence, and `CC` is an ISO 7064 MOD 97-10 check pair. Every permid is held once in the `permids` registry table, every permid column is text with a format and check-digit CHECK and a foreign key to that registry, and permids are minted or registered only in SQL, never in application code.

## Requirements

### Requirement: A permid is a prefixed number with two check digits
Every permid SHALL be text of the form `<PREFIX>-<number>-<CC>`:
- `<PREFIX>` is one of the prefixes in "Each permid space has one prefix", in upper case.
- `<number>` is a positive decimal integer with no leading zeros.
- `<CC>` is two decimal digits computed by ISO 7064 MOD 97-10 over the ID with its hyphens removed.
  Each letter becomes its two-digit value (A=10 … Z=35), `00` is appended, and
  `CC = 98 − (that integer mod 97)`, zero-padded to two digits. A permid is valid when its whole
  value, hyphens removed and letters converted, is congruent to 1 mod 97.

The prefix is inside the checksum, so a permid with a mistyped prefix fails the check instead of
naming a record of another type.

#### Scenario: Check digits for a collection
- **WHEN** Classic collection 12345 is given its permid
- **THEN** the permid is `COL-12345-70`

#### Scenario: Same number, different prefix
- **WHEN** `REF-12345` is formatted
- **THEN** its check digits are `15`, and `REF-12345-70` is not a valid permid

#### Scenario: A transposition is caught
- **WHEN** `COL-12354-70` (digits 4 and 5 swapped) is checked
- **THEN** it is not a valid permid

#### Scenario: Leading zeros are not allowed
- **WHEN** a value such as `COL-012345-70` is written to a permid column
- **THEN** PostgreSQL rejects it with a check-constraint violation

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

`REF`, `PRS`, `COL`, `SPM`, `INT` and `TSC` are the PBDB Classic data service's identifier
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

### Requirement: The permids registry holds every permid once
The schema SHALL define `permids (permid text COLLATE "C" PRIMARY KEY, created_at timestamptz NOT
NULL DEFAULT now())`, with one row per entity. A row SHALL be written once, when the entity's
permid is created, and never updated. `created_at` records when the entity was created, not its
latest version. The registry SHALL NOT carry an entity-type column: the prefix states the type.

#### Scenario: One row per entity, not per version
- **WHEN** a reference is migrated and then edited twice, giving three `refs` rows
- **THEN** `permids` holds one row for its permid

#### Scenario: Registry rows are never reused
- **WHEN** a permid already in `permids` is inserted again
- **THEN** PostgreSQL rejects the write with a primary-key violation

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
  `homonyms.permid` and `specimens.name_opinions_permid`, all `TXN`;
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

#### Scenario: Every permid column compares bytewise
- **WHEN** the DDL is applied and `information_schema.columns` is read for the public `text` columns
  whose names end in `permid`
- **THEN** every one has `collation_name = 'C'`

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
- a number is less than 1 or at least 1,000,000 (the sequence floor), because such a permid could
  collide with a minted one;
- a number appears twice in the input;
- a resulting permid is already registered.

A script that re-runs over existing rows SHALL register only the permids of rows it newly inserts.

#### Scenario: Registering Classic references
- **WHEN** `register_permids('REF', ARRAY[12345, 96229])` is called on an empty registry
- **THEN** it returns `{REF-12345-15, REF-96229-78}`, and both are in `permids`

#### Scenario: A legacy number registered twice fails
- **WHEN** two different source rows would both register `AUT-526271-06`
- **THEN** the second registration raises an error, instead of the second row silently becoming
  a version of the first

#### Scenario: A legacy number at the floor is refused
- **WHEN** `register_permids('COL', ARRAY[1000000])` is called
- **THEN** it raises an error

### Requirement: New numbers come from one sequence per prefix, starting at 1,000,000
The schema SHALL define one sequence per mintable prefix, each starting at 1,000,000. The DDL itself
sets the start, so a database built from the DDL needs no further setup before minting. The schema
SHALL define `mint_permids(prefix text, n integer) RETURNS text[]`, which takes `n` values from that
prefix's sequence, formats and registers each, and returns them in sequence order.

1,000,000 is above every Classic number that becomes a permid (the largest is `taxon_no`, 526,272),
so minted and legacy permids cannot collide, and a minted permid is visibly longer than any legacy
one.

#### Scenario: First minted schema permid
- **WHEN** `mint_permids('SCH', 1)` is the first mint for `SCH` in a database built from the DDL
- **THEN** it returns `{SCH-1000000-26}`

#### Scenario: A batch is minted in one call
- **WHEN** `mint_permids('AOP', 5000)` is called
- **THEN** it returns 5,000 distinct registered permids in increasing numeric order

### Requirement: Migration scripts get permids from the database
Migration scripts and API test fixtures SHALL obtain permids only by calling `register_permids` or
`mint_permids`, in batches. No JavaScript implementation of the check-digit algorithm SHALL exist:
the SQL format function is its only implementation. Scripts SHALL NOT use an externally sourced
identifier, such as PBot's `pbotID`, as the number or as the permid.

#### Scenario: No second implementation
- **WHEN** the repository's JavaScript is searched for the MOD 97-10 computation
- **THEN** none is found

#### Scenario: Batched, not row-by-row
- **WHEN** a migration inserts 5,000 rows that need sequence numbers
- **THEN** it obtains their permids from one `mint_permids` call, not 5,000

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
| `assignment_opinions`, `validity_opinions`, `taxon_annotations` | the sequence |
| `schemas`, `characters`, `states` | the sequence |
| sentinel rows, and any row with no Classic row | the sequence |

Classic `opinion_no` SHALL NOT be used as a permid number, because one Classic opinion can produce
more than one `name_opinions` row. An authority's absorbed `taxon_no`s other than the survivor's
SHALL remain in `legacyIDs.oldpbdbIDs`.

#### Scenario: A taxon's name and authority share a number
- **WHEN** Classic `taxon_no` 526,271 is migrated as an authority survivor and as a root name opinion
- **THEN** the authority's permid is `AUT-526271-06` and the root name opinion's permid is
  `TXN-526271-74`

#### Scenario: Merged authority
- **WHEN** Classic `taxon_no`s 100, 200 and 300 collapse into one authority
- **THEN** its permid's number is 100, and `authority.legacyIDs.oldpbdbIDs` is `['100', '200', '300']`

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
- **THEN** the permid has the prefix `TXN` and a number of at least 1,000,000, and no row of
  `taxa_linnaean` or `taxa` has that permid

### Requirement: Each table carries its permid's number for ordering
Every table with its own permid SHALL have
`permid_no bigint GENERATED ALWAYS AS (split_part(permid, '-', 2)::bigint) STORED`. On a versioned
table, a constraint `<table>_one_head_per_number`, `EXCLUDE (permid_no WITH =) WHERE (succeeded_by_id
IS NULL) DEFERRABLE INITIALLY DEFERRED`, SHALL guarantee one head per number. It is deferred because a
new version is inserted as a head before `handle_new_version()` closes the old head in its AFTER
trigger; a non-deferrable unique index would reject every new version. On an unversioned table
(`persons`, and the derived `taxa_linnaean`, `taxa_clades` and `taxa`), `permid` and `permid_no` SHALL
be `UNIQUE`. The permid text SHALL stay the source of truth, and `permid_no` is derived from it.

Within one table every permid has the same prefix, and the check digits depend only on the number,
so `permid_no` is a total order on the table's entities.

#### Scenario: Numeric, not textual, order
- **WHEN** heads with permids `COL-99-…` and `COL-100-…` are ordered by `permid_no`
- **THEN** `COL-99-…` comes first

#### Scenario: Two heads with one number are refused
- **WHEN** a transaction would commit leaving a second head with an existing head's `permid_no`
- **THEN** PostgreSQL rejects the commit with an exclusion-constraint violation

#### Scenario: A new version is accepted
- **WHEN** a second row with an existing head's permid is inserted, and the version triggers close the
  old head
- **THEN** the insert succeeds, and the table holds two rows and one head for that permid

### Requirement: No stored output is ordered by permid text
Wherever the order of permids decides a stored value, the order SHALL be by permid number
(`permid_no`, or `split_part(permid, '-', 2)::bigint`), never by the text. Neither the database
collation nor `"C"` gives numeric order (`"C"` sorts `TXN-100-…` before `TXN-99-…`). This covers
the derive functions' last-resort tie-breaks and `cycle_cuts.cycle_members`, which SHALL list a
cycle's members in ascending permid number. Grouping labels that are never stored, such as the
union-find representatives `min(node)`, are not covered.

#### Scenario: Cycle members are listed by number
- **WHEN** a derive function records a cut whose cycle has members `TXN-65255-71` and
  `TXN-135885-54`
- **THEN** that `cycle_cuts` row's `cycle_members` lists `TXN-65255-71` first

#### Scenario: Derived output doesn't depend on the collation
- **WHEN** the taxa tables are rebuilt once with the permid columns under the database default
  collation and once under `"C"`, from the same opinions
- **THEN** `taxa_linnaean`, `taxa_clades`, `taxa_attachments`, `taxa` and `cycle_cuts` have the same
  contents
