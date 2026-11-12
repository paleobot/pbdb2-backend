## Context

`migrate-pbot-schemas.js` resolves a schema's references with `lookupRefByPbotID`, a query on `refs.reference->'legacyIDs'->>'pbotID'`. The primary reference (lowest `order`) sets `schemas.reference_id`, and if it can't be resolved the schema is skipped. Additional references become `additional_schema_refs` rows, and an unresolved one is skipped with a warning. The runner fails the step on any skipped schema.

`pbot-refs` writes a `refs` row, tagged `legacyIDs.pbotID`, only for PBot references with a blank `pbdbid`. On 2026-11-10 it skipped 47 of 291 as already migrated from Classic. Those 47 are in `refs` only as Classic rows tagged `legacyIDs.oldpbdbID`, and their `pbotID` is recorded nowhere.

## Goals / Non-Goals

**Goals:**
- A schema citing a Classic-linked PBot reference resolves it to the Classic `refs` row.
- Every resolution through `pbdbid` can be reviewed after the run.
- Output is unchanged for every reference that resolves by `pbotID` today.

**Non-Goals:**
- Changing `pbot-refs` or the Classic `refs` rows.
- Detecting stub `pbdbid` values.
- Deciding whether private PBot records are migrated, or which token is used.
- A shared resolver for other PBot steps. `pbot-schemas` is the only step that cites references; a second caller can move the function to `src/lib/`.

## Decisions

### D1. Fall back from `pbotID` to `pbdbid` → `oldpbdbID`, in `pbot-schemas`

Resolution tries `legacyIDs.pbotID` = the reference's `pbotID`, then, if that finds nothing and the trimmed `pbdbid` is non-blank, `legacyIDs.oldpbdbID` = the trimmed `pbdbid`. The blank test is the one `pbot-refs` uses to decide to skip (`!pbdbid || !pbdbid.trim()`), so the two steps agree on which references are Classic-linked.

`pbotID` comes first because it is the exact identity of the record `pbot-refs` wrote. A PBot reference with a `pbdbid` is never written under its `pbotID`, so in practice the two lookups never both match.

*Alternative:* `pbot-refs` writes `legacyIDs.pbotID` onto the Classic row it skips in favour of. That has `pbot-refs` writing rows the `refs` step owns, which makes the result depend on run order. It also changes what `legacyIDs.pbotID` means: `pbot-refs` finds its own rows by it on a re-run, and its check of 244 written against 244 expected counts them.

### D2. One async resolver with injected lookups

`resolveReference(reference, { byPbotID, byPbdbID })` returns `{ id, via }`, where `via` is `'pbotID'`, `'pbdbid'` or `null`. The two lookups are the script's query functions in production and fakes in the unit test. Both call sites use it: the primary reference and each additional one. The lookup queries stay as they are, one per reference: there are about 10 schemas, so preloading `refs` would add code for no gain.

To make the resolver importable, the script runs `main()` only when invoked directly, as `migrate-refs.js` and `migrate-collections.js` do.

### D3. Log every `pbdbid` resolution with both titles

Each resolution through `pbdbid` logs the schema `pbotID`, the reference `pbotID`, the `pbdbid`, the PBot title and the Classic `refs` title. A mismatch then shows on the line itself, as in "Ref-ddm-08-25a" → "Macroevolutionary dynamics and historical biogeography…". The `pbdbid` lookup returns the Classic title alongside the id for this.

The summary gets one new line, `Refs via pbdbid: primary=N, additional=M`, after `Additional refs:`. The runner's summary parser matches only the Schemas, Characters and States lines, so it is unaffected. The run log keeps the step's stdout.

An unresolved reference's warning adds `(pbdbid <n>, no Classic ref)` when the `pbdbid` is non-blank, so a dangling link is distinguishable from a missing PBot ref.

## Risks / Trade-offs

- **[A stub or mistyped `pbdbid` links a schema to an unrelated Classic ref]** → It can't be detected from the data. The D3 log line puts both titles side by side for review. Stub `pbdbid`s are a PBot data-entry practice for test records, which the user cleans up before real migrations.
- **[Private records enter the migration]** → They do only with a token that can see them. Whether that is wanted is out of scope; this change only makes the step correct whichever token is used.
- **[A future PBot step cites references and repeats the bug]** → The resolver is one small exported function, ready to move to `src/lib/` when there is a second caller.

## Migration Plan

1. Implement D1–D3 with unit tests for the resolver.
2. Full runner against localhost `pbdb` with the current token, which sees the private test schemas. Expect `Schemas: fetched=10, inserted=10, skipped=0`, a `pbdbid` resolution line for each test schema, and the runner's "success — 11 step(s) completed, audit clean".
3. Check that every other step total matches the 2026-11-10 run.

Rollback: revert the commit. The step then skips the two test schemas again, and the runner fails as on 2026-11-10.

## Open Questions

- Private PBot records: migrate them or not? The user is asking others; the likely answer is yes. The answer doesn't change this design.
