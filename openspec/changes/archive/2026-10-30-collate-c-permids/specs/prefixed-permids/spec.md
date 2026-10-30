## MODIFIED Requirements

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

## ADDED Requirements

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
