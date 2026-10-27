## MODIFIED Requirements

### Requirement: Layer 1 assertion tables exist

The schema SHALL define three append-only assertion tables — `name_opinions`, `assignment_opinions`, and `validity_opinions` — each carrying a `bigint` identity primary key, a `permid text`, `authorizer_person_id`/`enterer_person_id` FKs to `persons`, `reference_id` FK to `refs`, an `evidence boolean NOT NULL`, an optional `pubyr integer` and `attribution jsonb`, a `removed boolean`, and `preceded_by_id`/`succeeded_by_id` self-referencing FKs. All `*_permid` columns SHALL be `text` with an FK to the `permids` registry and a CHECK on their prefix (`prefixed-permids`).

#### Scenario: The three opinion tables are present with their key columns

- **WHEN** the DDL is applied to an empty database
- **THEN** `name_opinions`, `assignment_opinions`, and `validity_opinions` each exist with the columns above, and no `rank_opinions`, `rename_opinions`, `type_opinions`, or `trait_opinions` table exists

#### Scenario: permid columns are foreign keys to the registry

- **WHEN** an opinion row is inserted whose `subject_permid` (or target) is a well-formed `NOP` permid that is not in `permids`
- **THEN** PostgreSQL rejects the insert with a foreign-key violation

### Requirement: Non-derived tables sit outside the stack

The schema SHALL define `taxon_annotations` (versioned curatorial prose: `common_name`, `comments`, `discussion`, `discussed_by_reference_id`) with its own `TAN` permid, keyed by `subject_permid` (`NOP`), and `homonyms` grouping `NOP` permids by an app-minted `homonym_group_id uuid` (uuidv7), with `UNIQUE (homonym_group_id, permid)`. Neither SHALL be reconstructable by `derive()`; `taxa_linnaean` SHALL NOT carry a `has_homonym` flag.

#### Scenario: Annotations and homonyms exist independently of the ledger

- **WHEN** the DDL is applied to an empty database
- **THEN** `taxon_annotations` and `homonyms` exist, and `taxa_linnaean` has no `has_homonym` column

#### Scenario: A homonym group spans more than two members

- **WHEN** three `NOP` permids are inserted into `homonyms` sharing one `homonym_group_id`
- **THEN** all three rows are accepted (grouped representation supports n > 2 homonyms)

### Requirement: classification_path materializes the concept adjacency

`derive_linnaean()` SHALL produce `classification_path` as an `ltree` of concept permids from root to node, consistent with `containing_concept_permid` (adjacency is primary; the path is derived from it). Each label SHALL be the concept permid exactly as stored, hyphens included; no character substitution SHALL be applied, because PostgreSQL 16 and later accept `-` in ltree labels.

#### Scenario: The path matches the adjacency chain

- **WHEN** concept C is contained by B which is contained by root A
- **THEN** C's `classification_path` is the ltree `A.B.C` (and `containing_concept_permid = B`)

#### Scenario: Labels are the permids themselves

- **WHEN** a concept with permid `NOP-526272-68` appears in a path
- **THEN** its label in `classification_path` is `NOP-526272-68`, not `NOP_526272_68`

## REMOVED Requirements

### Requirement: permid columns enforce uuidv7
**Reason**: Permid columns are `text`, not `uuid`. The version-7 CHECK becomes a prefix, format and check-digit CHECK plus an FK to the `permids` registry.
**Migration**: See `prefixed-permids`, "Every permid column is text, checked, and a foreign key to the registry". `homonyms.homonym_group_id` keeps its version-7 CHECK (same capability).
