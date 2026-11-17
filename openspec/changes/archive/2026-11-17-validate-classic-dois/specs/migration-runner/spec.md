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
   them. The inputs at present are `src/refs-migration/inputs/doi-verdicts.csv`, read by `refs`, and
   `mistagged-original-spelling.csv`, read by `opinions`.

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

#### Scenario: Missing DOI verdict file fails before the pipeline starts
- **WHEN** the full pipeline is selected and `src/refs-migration/inputs/doi-verdicts.csv` is absent
- **THEN** preflight fails naming that file, before `persons` is spawned

#### Scenario: Input files are declared, not discovered
- **WHEN** a step reads a file from disk
- **THEN** its path appears in that step's declared input list, so preflight checks it without parsing the step's source

#### Scenario: Unseeded payload vocabulary is caught up front
- **WHEN** the target database has the schema created but `dictionaries.lithologies` is empty
- **THEN** preflight fails naming that table, rather than the `collections` step failing at enum resolution after eight steps have loaded

#### Scenario: Unseeded languages is caught up front
- **WHEN** the target database has the schema created but `dictionaries.languages` is empty
- **THEN** preflight fails naming that table, rather than the `refs` step failing at enum resolution
