## MODIFIED Requirements

### Requirement: Preflight assertions run once before the first step
Before spawning any step, the runner SHALL verify all of the following and SHALL abort without spawning
anything if any check fails:

1. **Environment.** Every variable required by the selected steps is set. `PG_HOST`, `PG_USER`,
   `PG_PASSWORD`, and `PG_DATABASE` are required by every step. `MARIADB_HOST`, `MARIADB_USER`,
   `MARIADB_PASSWORD`, and `MARIADB_DATABASE` are required by `persons`, `refs`, `authorities`,
   `authority-opinions`, `opinions`, and `collections`. `PBOT_TOKEN` is required by `pbot-persons`, and
   by `pbot-refs` and `pbot-schemas` only when `--pbot-include-private` is given. The required set SHALL
   be the union over the *selected* steps only. When `pbot-refs` or `pbot-schemas` is selected, the
   environment check SHALL report the PBot record scope: `token, including private records` with the
   flag, otherwise `anonymous, public records only`.
2. **Connectivity.** The PostgreSQL connection succeeds, and the MariaDB connection succeeds if any
   selected step requires it.
3. **Dictionaries.** All 22 `dictionaries.*` tables — `genders`, `roles`, `interval_types`, `zone_types`,
   `taxonomy_ranks`, `book_types`, `parts_preserved`, `notable_features`, `namechange_reasons`,
   `nomenclatural_statuses`, `admin0`, `admin1`, `maritime`, and the payload vocabularies
   `collection_methods`, `coordinate_bases`, `geographic_scales`, `lithologies`, `lithology_adjectives`,
   `dating_methods`, `preservation_modes`, `institution_codes`, `languages` — exist and are non-empty.
   `reference_types` is not among them: it no longer exists.
4. **First-writer emptiness.** Every target table that a selected step is the *first* writer of is empty.
5. **Required input files.** Every file a selected step reads from disk exists and is readable. Each step
   SHALL declare its input files, and the runner SHALL check the declared paths rather than inferring
   them. The only such input at present is `mistagged-original-spelling.csv`, read by `opinions`.

#### Scenario: Missing token fails before any work
- **WHEN** `PBOT_TOKEN` is unset and the full pipeline is selected
- **THEN** the runner aborts during preflight, before spawning `persons`, because `pbot-persons` requires it, rather than failing at step 2 after `persons` has loaded

#### Scenario: Public-only run reports its scope
- **WHEN** the full pipeline is selected without `--pbot-include-private` and `PBOT_TOKEN` is set
- **THEN** preflight passes and the environment line reports `PBot records: anonymous, public records only`

#### Scenario: Private records need the token for every PBot step
- **WHEN** `--only pbot-schemas --pbot-include-private` is passed and `PBOT_TOKEN` is unset
- **THEN** preflight fails naming `PBOT_TOKEN`, although `pbot-schemas` alone does not require it without the flag

#### Scenario: Unselected step's environment is not demanded
- **WHEN** the runner is invoked with `--from authorities` and `PBOT_TOKEN` is unset
- **THEN** preflight passes, because no selected step requires `PBOT_TOKEN`

#### Scenario: Unseeded dictionaries are caught up front
- **WHEN** the target database has the schema created but `dictionaries.taxonomy_ranks` is empty
- **THEN** preflight fails naming that table, because the steps that read it would otherwise fail partway through the pipeline

#### Scenario: Populated target refuses a full run
- **WHEN** the full pipeline is selected and `authorities` already contains rows
- **THEN** preflight fails, because `migrate-authorities.js` inserts without an upsert or natural key and would duplicate every row

#### Scenario: Missing input file fails before the pipeline starts
- **WHEN** the full pipeline is selected and `mistagged-original-spelling.csv` is absent
- **THEN** preflight fails naming that file, rather than the `opinions` step failing on `readFileSync` after the six preceding steps have already loaded their data

#### Scenario: Input files are declared, not discovered
- **WHEN** a step reads a file from disk
- **THEN** its path appears in that step's declared input list, so preflight checks it without parsing the step's source

#### Scenario: Unseeded payload vocabulary is caught up front
- **WHEN** the target database has the schema created but `dictionaries.lithologies` is empty
- **THEN** preflight fails naming that table, rather than the `collections` step failing at enum resolution after eight steps have loaded

#### Scenario: Unseeded languages is caught up front
- **WHEN** the target database has the schema created but `dictionaries.languages` is empty
- **THEN** preflight fails naming that table, rather than the `refs` step failing at enum resolution

### Requirement: Steps run as isolated child processes
The runner SHALL execute each step as a child process invoking the step's entry point with `node`, and
SHALL NOT import a step's module into the runner process. Each step SHALL therefore manage its own
connection pools and produce its own exit code.

When `--pbot-include-private` is given, the runner SHALL pass it as an argument to `pbot-refs` and
`pbot-schemas`, and SHALL NOT pass it to any other step.

This is required because the entry points are not uniform: six of the eleven, `src/rebuild-taxa.js`
among them, call `main()` unconditionally at module load, and five guard it behind an
`import.meta.url === file://${process.argv[1]}` check.

#### Scenario: Unconditional-main script is spawned safely
- **WHEN** the runner reaches `refs`, whose module calls `main()` at load time with no `invokedDirectly` guard
- **THEN** the runner spawns it as a child process, so module load and migration execution stay inside that child

#### Scenario: Child inherits configuration
- **WHEN** a step is spawned
- **THEN** it inherits the parent environment, so all steps resolve the same `PG_*` and `MARIADB_*` connection settings from `.env`

#### Scenario: The include-private flag reaches only the steps it affects
- **WHEN** the full pipeline runs with `--pbot-include-private`
- **THEN** `pbot-refs` and `pbot-schemas` are spawned with `--pbot-include-private` in their arguments, and `pbot-persons` and every other step are spawned without it

### Requirement: Incoherent flag combinations are rejected
The runner SHALL reject the following combinations with a non-zero exit and an explanatory message, before
connecting to any database:

- `--from` together with `--only`.
- `--createdb` together with `--from <step>` where the step is not `persons`.
- `--createdb` together with `--only <step>` where the step is not `persons`.
- Any `--from` or `--only` value that is not a step name in the run-order table.
- `--pbot-include-private` when neither `pbot-refs` nor `pbot-schemas` is selected.

The runner SHALL NOT provide a flag that bypasses a failed precondition or postcondition.

#### Scenario: Reset plus resume is contradictory
- **WHEN** `--createdb --from authorities` is passed
- **THEN** the runner exits non-zero explaining that `--createdb` yields an empty database while `--from authorities` asserts that the five preceding steps have already run

#### Scenario: Unknown step name
- **WHEN** `--only taxon` is passed
- **THEN** the runner exits non-zero listing the valid step names, because step names are matched literally and `taxon` is not `taxa`

#### Scenario: No override exists
- **WHEN** a user wishes to run a step whose precondition fails
- **THEN** no flag permits it, because the preconditions are the runner's purpose rather than an advisory check

#### Scenario: Include-private with no PBot record step
- **WHEN** `--from authorities --pbot-include-private` is passed
- **THEN** the runner exits non-zero before connecting, explaining that `--pbot-include-private` affects only `pbot-refs` and `pbot-schemas` and neither is selected
