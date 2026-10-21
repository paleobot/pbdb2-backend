## MODIFIED Requirements

### Requirement: A non-migration script may live directly under `src/`
A script that orchestrates or operates on migrations rather than performing one SHALL be permitted to live
directly under `src/`, above the per-migration directories. Such a script SHALL NOT be given a `migrate-<subject>.js`
name and SHALL NOT be given a `<subject>-migration` directory, because both forms are reserved for
migrations themselves and would make the script indistinguishable from one in a directory listing or in
the inventory.

`src/run-migrations.js` is such a script. So is `src/rebuild-taxa.js`, the entry point of the runner's
`taxa` step: it derives the taxa tables from migrated opinion data by calling `rebuild_taxa_full()` and
reads no legacy system, so it operates on migrated data rather than migrating any. Neither SHALL appear in
this specification's inventory of migration scripts, which records only migrations. A runner step is
therefore not by itself a migration: what decides the placement is whether the script moves data out of a
legacy system.

The rule that a migration imports shared code from `src/lib/` rather than from a sibling migration's
directory applies unchanged to a script placed here. A non-migration script MAY, however, reference
migration entry points by path, since invoking them is its purpose; such references are executable paths
and SHALL be updated whenever a referenced script is relocated.

#### Scenario: Runner is placed above the migration directories
- **WHEN** the migration runner is added to the repository
- **THEN** it is written to `src/run-migrations.js`, not to `src/migration-runner/migrate-runner.js`, so that its position above the per-migration directories reflects that it orchestrates them

#### Scenario: Name is distinguishable from a migration
- **WHEN** a reader lists `src/`
- **THEN** `run-migrations.js` is recognisable as not being one of the `migrate-<subject>.js` entry points, and the inventory confirms it is not a migration

#### Scenario: Entry-point references are executable paths
- **WHEN** a migration script named in `src/run-migrations.js` is relocated under `src/`
- **THEN** the relocating change updates the path in the runner, because it is an executable path rather than a prose citation

#### Scenario: A derivation step is not a migration
- **WHEN** the runner gains its `taxa` step, whose script calls `rebuild_taxa_full()` over tables earlier steps loaded
- **THEN** the script is placed at `src/rebuild-taxa.js`, not in a `src/taxa-migration/` or `src/taxa-rebuild/` directory, and it is not added to the migration inventory
