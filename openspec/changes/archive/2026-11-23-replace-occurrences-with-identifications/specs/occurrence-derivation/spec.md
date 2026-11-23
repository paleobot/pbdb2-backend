## Purpose

How the `occurrences` cache is derived from `identifications`: which identification wins, what happens when the root or a later identification is removed, how plant organs are inherited, and how the cache is rebuilt without changing ids or leaving stale rows.

## ADDED Requirements

### Requirement: Each live root yields one occurrence whose permid is the root's
Deriving occurrences SHALL produce exactly one row for each occurrence whose root identification has a head version that is not
removed, and none for any other. That row's `permid` SHALL equal the root's `permid`. Its `collection_id` and `reference_id`
SHALL be the root's, and its `taxon_permid`, `identification` and `winning_identification_id` SHALL be those of the winning
identification (see "The winner is the identification citing the latest reference").

#### Scenario: One row per occurrence
- **WHEN** a root and two non-root identifications of it exist
- **THEN** the derivation yields one occurrence row, with the root's permid

#### Scenario: The winner's name and taxon are carried
- **WHEN** the winning identification has `taxon_permid` T and genus name G
- **THEN** the occurrence row has `taxon_permid` T and an `identification` payload containing G

### Requirement: The winner is the identification citing the latest reference
Among the head, non-removed identifications of an occurrence (the root included), the winner SHALL be the one whose reference has the
latest publication year, an identification whose reference has no publication year ranking after every dated one. Ties SHALL be
broken by the identification lineage's first-entry time (the earliest `created_at` among all versions sharing its `permid`),
latest first, and then by the lineage's lowest `id`, highest first. A row with NULL first-entry time SHALL rank after every
dated one.

#### Scenario: A later reference wins over a later entry
- **WHEN** the root cites a 1958 reference and a reidentification entered later cites a 1954 reference
- **THEN** the root is the winner

#### Scenario: A later reference wins over an earlier entry
- **WHEN** a reidentification entered earlier cites a 1990 reference and one entered later cites a 1980 reference
- **THEN** the 1990 identification is the winner

#### Scenario: Entry time breaks a year tie
- **WHEN** two identifications cite references of the same publication year
- **THEN** the one whose lineage was first entered later is the winner

#### Scenario: Correcting an old identification does not change the winner
- **WHEN** two identifications tie on publication year, and a new version of the earlier-entered one is then inserted
- **THEN** the winner is the same as before the new version

#### Scenario: An undated reference ranks last
- **WHEN** one identification cites a reference with no publication year and another cites a dated reference
- **THEN** the dated one is the winner

### Requirement: A removed root removes the occurrence; a removed later identification is ignored
If the head version of an occurrence's root identification is removed, the occurrence SHALL have no derived row. If a non-root
identification's head is removed, it SHALL be ignored when choosing the winner. If every non-root is removed, the root SHALL win.

#### Scenario: A removed root removes the occurrence
- **WHEN** the root's head is marked removed and the occurrence is rebuilt
- **THEN** no occurrence row exists for that permid

#### Scenario: A removed non-root is ignored
- **WHEN** the winning non-root identification is marked removed and the occurrence is rebuilt
- **THEN** the next-ranked remaining identification is the winner

#### Scenario: Only the root remains
- **WHEN** every non-root identification of an occurrence is removed
- **THEN** the root is the winner

### Requirement: Plant organs are inherited from the highest-ranked identification that has them
The derived row's plant organs SHALL be those of the highest-ranked identification (by the winner order) whose payload has at least
one plant organ, whether or not that identification is the winner. If no identification has any, the derived row SHALL have none.

#### Scenario: The winner is silent about organs
- **WHEN** the winner has no plant organs and an older identification has `["leaf"]`
- **THEN** the derived row's plant organs are `["leaf"]`

#### Scenario: Both have organs
- **WHEN** the winner has `["wood"]` and an older identification has `["leaf"]`
- **THEN** the derived row's plant organs are `["wood"]`

#### Scenario: None have organs
- **WHEN** no identification of the occurrence has plant organs
- **THEN** the derived row has none

### Requirement: Rebuilding keeps ids stable, changes nothing needlessly, and leaves no stale rows
Rebuilding occurrences SHALL upsert keyed on `permid`, preserving the `id` of every occurrence that persists, SHALL NOT modify a
row whose derived values are unchanged, and SHALL delete every occurrence row whose permid is no longer derived. Running it twice
in succession SHALL change no row the second time.

#### Scenario: Ids survive a rebuild
- **WHEN** occurrences are rebuilt after a new identification is added to an existing occurrence
- **THEN** the occurrence keeps its `id`

#### Scenario: A second rebuild is a no-op
- **WHEN** occurrences are rebuilt twice with no data change in between
- **THEN** the second run reports zero changed rows

#### Scenario: Orphans are deleted
- **WHEN** an occurrence's root is removed and occurrences are rebuilt
- **THEN** the cached row is deleted

#### Scenario: A reference year change can change the winner
- **WHEN** a new version of a reference changes its publication year such that another identification now ranks first, and occurrences are rebuilt
- **THEN** the occurrence's winner is that other identification

### Requirement: A restricted derivation matches the full one
Deriving with a set of occurrence permids SHALL return, for those permids, exactly the rows the full derivation returns for them.

#### Scenario: Restricted equals full
- **WHEN** occurrences are derived for a given permid set and for all permids
- **THEN** the rows for that set are identical in both results
