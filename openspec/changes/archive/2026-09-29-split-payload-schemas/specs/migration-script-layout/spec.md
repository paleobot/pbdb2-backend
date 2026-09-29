## ADDED Requirements

### Requirement: A migration's mapping documents live under its own directory
A migration's mapping documents SHALL live in a `docs/` subdirectory of that migration's directory, and SHALL
NOT live in `payloadSchemas/` or at the repository root. A mapping document records how a legacy source's
fields map to PBDB 2.0 tables, columns and payload fields. People read it and keep it up to date. No script
reads it at run time.

`docs/` keeps them apart both from `inputs/`, which holds files the script reads, and from the run artifacts
at the directory root, which are regenerated. A mapping document therefore has its own position, as the
input-file requirement gives inputs theirs.

Moving a mapping document keeps its file name, so that collaborators who edit it can find it by name. Every
reference to a moved document, in code comments, in `docs/`, and in `migration_exploration/`, SHALL name
its new path.

The mapping documents at the time of this requirement are:

| Document | Location |
|---|---|
| `opinions.md` | `src/opinions-migration/docs/` |
| `specimens.md` | `src/specimens-migration/docs/` |
| `authorities-opinions.md` | `src/authority-opinions-migration/docs/` |
| `collections.txt`, `collections-pbot.txt` | `src/collections-migration/docs/` |

#### Scenario: Opinions mapping location
- **WHEN** a contributor looks for the Classic opinions → 2.0 mapping
- **THEN** it is at `src/opinions-migration/docs/opinions.md`, and the header comment of
  `src/opinions-migration/migrate-opinions.js` names that path

#### Scenario: No mapping documents in payloadSchemas
- **WHEN** `payloadSchemas/` is listed after this change
- **THEN** it has no `mappings/` directory

#### Scenario: A new migration's mapping
- **WHEN** a future migration, for example occurrences, gets a mapping document
- **THEN** it is created at `src/occurrences-migration/docs/`, not in `payloadSchemas/`

#### Scenario: References follow the move
- **WHEN** the repository is searched for `payloadSchemas/mappings/` outside `openspec/changes/` (change artifacts, active or archived, record history)
- **THEN** there are no matches
