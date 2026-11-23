## Why

`replace-occurrences-with-identifications` was built on UUIDv7 permids. `main` has since replaced them with prefixed,
check-digited text permids held in a `permids` registry (`prefixed-permids`), and gave occurrences the `OCC` prefix. The
identification ledger, its abundance table and the derived `occurrences` cache must use the same permids as every other table,
or the branch cannot merge and the new tables would be the only ones off the registry.

## What Changes

- `identifications` takes `OCC` permids, root and non-root alike, following `name_opinions` and `TXN`: a root's permid is the
  occurrence's, and for a migrated occurrence it is `OCC-<occurrence_no>-<CC>`; a reidentification takes a number from the `OCC`
  sequence. Its `permid`, `occurrence_permid` and `taxon_permid` are `text COLLATE "C"` with a CHECK and an FK to `permids`, and it
  gains `permid_no` and the one-head-per-number constraint.
- `occurrence_abundances` takes a new `ABD` prefix (permid sequence from 10,000,000; Classic numbers no abundance), the same
  columns, and a deferred exclusion constraint replacing its version-1 unique index for "one abundance per occurrence".
- The derived `occurrences` cache has no prefix of its own; its `permid` is the root's `OCC` permid, text, registry-backed,
  UNIQUE, with `permid_no`. `derive_occurrences(seed)` takes `text[]`.
- `prefixed-permids` lists the new tables and the `ABD` prefix; `permid_prefix_digits`, `permid_abd_seq` and the registry
  functions in `db/02-core.sql` learn `ABD`.
- The mapping document gains the permid sources; the integration test replaces its `occurrences` cases with identification
  and abundance cases.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities
- `prefixed-permids`: the prefix table, the permid-column list, the number-source table and the unversioned-table list.
- `identification-schema`: permid, occurrence permid and taxon permid are prefixed text permids.
- `occurrence-abundance-schema`: `ABD` permid, `OCC` occurrence permid, deferred exclusion for one abundance per occurrence.
- `occurrence-schema`: the cache's permid is a registered `OCC` text permid.

## Impact

- `db/02-core.sql` (permid functions, sequence, `identifications`, `occurrence_abundances`, head constraints),
  `db/03-taxa.sql` (`occurrences`, `derive_occurrences`).
- `api/test/integration/permids.test.js`; `migrations/src/occurrences-migration/docs/occurrences.md`.
- No data migration: the tables have never held rows. The branch is rebased onto `main` (57 commits) as part of this change.
- Data-integrity risk: a root's permid number equals `occurrence_no`, so `register_permids('OCC', ...)` must be given the
  Classic numbers and the reidentification permids must be minted, never derived from `reid_no` (it overlaps).
