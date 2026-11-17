## Context

`db/03-taxa.sql` defines `rebuild_taxa_full()`, the supported entry point that rebuilds the four taxa
ledgers (`taxa_linnaean`, `taxa_clades`, `taxa_attachments`, `taxa`) from the opinion tables and
refreshes `cycle_cuts`. It runs in its caller's transaction and returns how many rows changed per
ledger. Until now nothing in the pipeline called it, so a fresh database had empty taxa tables.

The runner (`migrations/src/run-migrations.js`) has already gained an 11th step, `taxa`, that spawns a
small script calling the function. It was run on localhost `pbdb` on 2026-10-20 with `--only taxa`:
362 s, 525,805 `taxa` / 525,805 `taxa_linnaean` / 3,346 `taxa_clades` / 20,264 `taxa_attachments`,
plus 54 + 18 `cycle_cuts`. This change records that step in the specs and makes one placement fix.

## Goals / Non-Goals

**Goals:**
- A full runner invocation leaves the database with populated taxa tables.
- `taxa` is held to the same rules as every other step: named, ordered, preconditioned, postconditioned,
  logged.
- The specs describe the runner as it is.

**Non-Goals:**
- Refreshing the taxa tables after opinions change. That is a direct `rebuild_taxa_full()` call; the
  runner is a one-time loader.
- Changing `rebuild_taxa_full()` or any derivation logic.
- Auditing the taxa tables. They carry no jsonb payload, so there is nothing in the audit registry to
  check.

## Decisions

**D1. A step, not a post-pipeline hook.** Making the rebuild a step gives it `--only taxa`,
`--from taxa`, preconditions, postconditions and a run-log block without new machinery. A hook after the
last step would have needed its own selection, failure and logging rules.

**D2. Position 11, after `specimens`.** The step depends only on `opinions` (row 8), so it could sit at
9. Appending follows the run-order requirement's "a new step is appended, not inserted" pattern: rows 1–10
keep their positions, and `--from collections` still means what it meant. Running last also costs
nothing, since no step reads the taxa tables.

**D3. First writer of all four ledgers; `taxa` empty is a precondition.** `rebuild_taxa_full()` is
idempotent, but the postcondition that every written table *grew* would fail on a second run, and a
first-writer declaration makes preflight refuse a populated target. That matches every other step: the
runner loads an empty database once. The step therefore cannot be used to refresh. Alternative
considered: no first-writer declaration and a weaker "did not shrink" postcondition just for this step.
Rejected because it adds a special case to the postcondition rule for a use the runner is not for.

**D4. `cycle_cuts` is not among the written tables.** The function writes it, but it is a snapshot of the
current cut set and may legitimately be empty for some opinion data, so "grew" is not a valid check.

**D5. Preconditions: `taxa` empty; `name_opinions`, `assignment_opinions`, `validity_opinions`
non-empty.** The three opinion tables are exactly what `derive_*()` reads. `validity_opinions` is
checked even though `opinions` already guarantees it, because each step states its own inputs.

**D6. Environment: `PG` only.** The step reads no legacy system, so `--only taxa` needs no `MARIADB_*`
or `PBOT_TOKEN`.

**D7. Script at `src/rebuild-taxa.js`.** It is currently at `src/taxa-rebuild/rebuild-taxa.js`.
`migration-script-layout` reserves directories under `src/` for migrations (`<subject>-migration/`) and
places scripts that are not migrations directly under `src/`, as with `run-migrations.js` and
`audit-payloads.js`. The step is a derivation, so it goes there. Alternative considered:
`src/taxa-migration/migrate-taxa.js`, which fits the migration convention but misnames a step that
migrates nothing and would put it in the migration inventory.

## Risks / Trade-offs

- [A full run takes about six minutes longer (≈3 → ≈9 min)] → Accepted. `--from`/`--only` still let an
  operator skip it, and the README states the new time.
- [The runner cannot refresh taxa after opinion edits] → By design (D3). The README and spec say to call
  `rebuild_taxa_full()` directly.
- [Rebuild failure mid-run] → The whole function runs in one transaction, so the taxa tables stay empty
  and the runner halts with the step marked failed. Migrated tables are not touched.

## Migration Plan

Verification: after moving the script, `node src/run-migrations.js --list` ends in `taxa`,
`npm test` in `migrations/` passes, and `openspec validate add-taxa-rebuild-runner-step` passes.
Localhost is already populated, so `--only taxa` there now correctly fails preflight on `taxa` being
non-empty. That failure is the check that the first-writer guard works.
