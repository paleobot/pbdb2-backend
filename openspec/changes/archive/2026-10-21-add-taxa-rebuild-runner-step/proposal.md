## Why

After a full migration run the `taxa` table is empty: the runner loads the opinion ledgers but nothing
calls `rebuild_taxa_full()` (`db/03-taxa.sql`), which derives `taxa_linnaean`, `taxa_clades`,
`taxa_attachments` and `taxa` from them. The runner has already been given an 11th step, `taxa`, that
does this. The specs still describe a ten-step pipeline, and one scenario uses `--only taxa` as an
example of an *invalid* step name. This change records the step in the specs and settles where its
script lives.

## What Changes

- Record `taxa` as row 11 of the runner's run-order table, after `specimens`, with its dependency edge
  (`opinions` → `taxa`), preconditions, tables written, and audit behaviour (none: it writes no payload
  table).
- State that `taxa` is a derivation, not a migration: it reads only PostgreSQL, calls
  `rebuild_taxa_full()`, and is the first writer of the four taxa tables, so the runner refuses to run
  it against a populated `taxa`. Refreshing the tables after opinions change is a direct
  `rebuild_taxa_full()` call outside the runner.
- Replace the "unknown step name" scenario's `--only taxa` with a name that is not a step.
- Update the "ten steps" and entry-point counts that the new step makes stale.
- Move the step's script from `src/taxa-rebuild/rebuild-taxa.js` to `src/rebuild-taxa.js`, the place
  `migration-script-layout` gives a script under `src/` that is not a migration (next to
  `run-migrations.js` and `audit-payloads.js`). Directories under `src/` hold one migration each.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `migration-runner`: run order, step-name stability scenarios, child-process counts, per-step
  preconditions, postcondition table list, unknown-step scenario, and audit scenarios gain the `taxa`
  step.
- `migration-script-layout`: the non-migration-script requirement names `src/rebuild-taxa.js` alongside
  `src/run-migrations.js` as a script under `src/` that is not a migration and is kept out of the
  migration inventory.

## Impact

- `migrations/src/run-migrations.js` (step entry-point path, header comments),
  `migrations/src/README.txt`, and the step script, which moves to `migrations/src/rebuild-taxa.js`.
- No source system is read: the step reads `name_opinions`, `assignment_opinions` and
  `validity_opinions` and writes `taxa_linnaean`, `taxa_clades`, `taxa_attachments`, `taxa` and
  `cycle_cuts`. No MariaDB or PBot tables, type mappings or legacy anomalies are involved.
- **Data integrity:** the step writes only derived tables, and the whole rebuild runs in one transaction,
  so a failure leaves them as they were. No migrated row is touched. A full run takes about six minutes
  longer (localhost: 362 s).
