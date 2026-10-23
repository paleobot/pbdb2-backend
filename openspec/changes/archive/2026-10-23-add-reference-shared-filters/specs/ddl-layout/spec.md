## MODIFIED Requirements

### Requirement: Objects are placed by function
Each object SHALL go in the file whose function it serves:
- `01-dictionaries.sql`: the `dictionaries` schema and every `dictionaries.*` table with its seed rows,
  including dictionaries used by only one domain (`taxonomy_ranks`, `namechange_reasons`,
  `nomenclatural_statuses`).
- `02-core.sql`: the tables whose rows are written by the application (API or migration), with their
  indexes and the functions and triggers they need. These are the versioning trigger functions, the
  `lookup` schema, the `postgis` and `unaccent` extensions, the versioned entities from `persons` through `authorities`,
  the opinion ledgers (`name_opinions`, `assignment_opinions`, `validity_opinions`), and the hand-entered
  non-derived tables (`taxon_annotations`, `homonyms`).
- `03-taxa.sql`: the tables whose rows are written by the rebuild functions (`taxa_linnaean`,
  `taxa_clades`, `taxa_attachments`, `taxa`, `cycle_cuts`), with their indexes, every `derive_*`,
  `rebuild_*` and `assert_*_invariant` function, and the `ltree` extension.

A new table goes in `02-core.sql` if the application writes its rows, and in `03-taxa.sql` if a rebuild
function derives them.

#### Scenario: The opinion ledgers are core
- **WHEN** `02-core.sql` is read
- **THEN** it defines `name_opinions`, `assignment_opinions` and `validity_opinions` and their indexes, and `03-taxa.sql` defines none of them

#### Scenario: Taxonomy dictionaries are dictionaries
- **WHEN** `01-dictionaries.sql` is read
- **THEN** it defines `dictionaries.taxonomy_ranks`, `dictionaries.namechange_reasons` and `dictionaries.nomenclatural_statuses` with their seeds

#### Scenario: Derived output is taxa
- **WHEN** `03-taxa.sql` is read
- **THEN** it defines `taxa_linnaean`, `taxa_clades`, `taxa_attachments`, `taxa` and `cycle_cuts`, and every function named `derive_*`, `rebuild_*` or `assert_*_invariant`

#### Scenario: Core holds the text-matching extension
- **WHEN** `02-core.sql` is read
- **THEN** it creates the `unaccent` extension, and no other file does
