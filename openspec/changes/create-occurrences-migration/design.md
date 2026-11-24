## Context

See proposal.md for motivation. The target tables, their shape rules and the winner rule are settled in the
archived `replace-occurrences-with-identifications` and `port-identifications-to-prefixed-permids` changes and
in the specs `identification-schema`, `occurrence-abundance-schema`, `occurrence-derivation`,
`occurrence-schema` and `prefixed-permids`. The column-by-column mapping is
`src/occurrences-migration/docs/occurrences.md`. This design covers only how the script loads that target.

Measured 2026-11-24 on MariaDB `pbdb_2026_10_18` and localhost `pbdb`; these replace the mirror figures in the
mapping document:

| Fact | Value |
|---|---|
| Classic `occurrences` | 2,011,484 (max `occurrence_no` 2,078,017) |
| …whose `collection_no` is 0 or absent from Classic `collections` | 625 |
| …whose collection exists in Classic but not in PostgreSQL | 1 (collection 27182, one occurrence) |
| …with `authorizer_no` or `enterer_no` = 0, among the rest | 0 |
| …whose reference is unset or missing (collection fallback) | 13 |
| …with `taxon_no` 0 or NULL / an orphan `taxon_no` | 51,339 / 10 |
| …with a non-empty `abund_value` or `abund_unit` | 808,849 |
| Classic `reidentifications` | 35,492 |
| …whose occurrence does not exist | 15 |
| …whose reference is unset or missing | 0 |
| …with `taxon_no` = 0 | 428 |
| …naming a different collection from their occurrence | 12 |
| PostgreSQL `collections` heads | 279,599 (Classic 279,600) |

Constraints from the existing code:

- `migrate-specimens.js` is the closest model: mysql2 stream, pure exported payload builders, ajv `db`
  variant, one PostgreSQL transaction, `registerPermids` per batch, `--dry-run`, the anomaly log. It stages
  every row in memory before inserting, which is fine at 167K rows and not at 2M.
- No migration carries a Classic timestamp: every table's `created_at` is the migration time, and Classic's
  `created` is not kept anywhere (D4).
- `derive_occurrences()` breaks a publication-year tie by the lineage's first `created_at`, then its first id.
- The runner's step table, its `AUDIT_REGISTRY`, and `src/audit-payloads.js` each need an entry.

## Goals / Non-Goals

**Goals:**
- Load every Classic identification act as one `identifications` row and every recorded abundance as one
  `occurrence_abundances` row, then derive `occurrences`, in a single run step that is all-or-nothing.
- Permids that are identical across rebuilds from `--createdb`.
- Every row not loaded is listed with a reason, and the list is checked, not just written.

**Non-Goals:**
- Choosing between the winner rules (the 775 question); the load is the same either way.
- Expanding ditto marks, repairing inverted timestamps, or resolving the 12 collection conflicts.
- Backfilling `specimens` from occurrences (mapping rule 10).
- Fixing why collection 27182 was not migrated; that belongs to the collections migration (Open Questions).

## Decisions

### D1 — One script, one transaction, two streamed passes

`src/occurrences-migration/migrate-occurrences.js` opens one PostgreSQL transaction and makes two passes:

```
 pass 1  MariaDB occurrences ORDER BY occurrence_no ──► batch of 1,000
           ├─ register OCC-<occurrence_no>       ──► identifications (roots)
           └─ mint ABD for the batch's abundances ──► occurrence_abundances
 pass 2  MariaDB reidentifications ORDER BY reid_no ──► batch of 1,000
           └─ mint OCC from the sequence          ──► identifications (non-roots)
 then    SELECT rebuild_occurrences()             ──► occurrences
 COMMIT  (or ROLLBACK under --dry-run or on any failure)
```

Each batch is built, validated and inserted before the next is read; nothing is staged across batches. The
`for await` loop over the mysql2 stream gives backpressure while an insert is awaited.

*Alternative:* stage everything like specimens. Rejected: 2M payloads plus their JSON would take gigabytes.
*Alternative:* abundances as a third pass. Rejected: it would re-read 2M occurrence rows to use 40% of them;
minting them inside pass 1 keeps the same order guarantee (D3).

*Alternative:* call `rebuild_occurrences()` as a separate runner step, as `taxa` is. Rejected: `taxa` is a
separate step because it derives from three earlier steps' output. `occurrences` derives only from this step's
rows, and running the rebuild in the same transaction means a failed derive leaves no half-loaded ledger.

### D2 — What is excluded is decided against PostgreSQL, and checked against the CSVs

A root is loaded when its `collection_no` resolves to a `collections` head through `legacyIDs.oldpbdbID`. The
test is against PostgreSQL, not Classic, because they differ: collection 27182 exists in Classic but was not
migrated, so its one occurrence must be excluded or the NOT NULL `collection_id` aborts the run. A
reidentification is loaded when its occurrence was loaded as a root.

The script records each excluded row (occurrence or reidentification, number, reason) and, before committing,
compares that set with `docs/occurrences-excluded.csv`. Any difference fails the run and prints it. The CSV is
regenerated against `pbdb_2026_10_18` during this change (expected 626 occurrences + 15 reidentifications) with
the category column Andrew's version has; a later dump that changes the set fails loudly instead of drifting.

The 12 collection conflicts are not exclusions: the reidentification loads with no collection, and the script
logs both collections to the anomaly log. `docs/occurrences-collection-conflicts.csv` is regenerated the same way
and checked the same way.

*Alternative:* read the CSV and skip the rows it names. Rejected: the CSV would then be the rule rather than the
record of it, and a missing line would surface as a constraint violation deep in the run.

### D3 — Permid sources and order

- Root: `registerPermids(client, 'OCC', occurrence_nos)` per batch, as `SPM` is registered from `specimen_no`.
  `occurrence_permid` is the same value.
- Abundance: `mintPermids(client, 'ABD', n)` per batch, assigned in `occurrence_no` order within the batch.
- Non-root: `mintPermids(client, 'OCC', n)` per batch, assigned in `reid_no` order. Its `occurrence_permid` is
  the root's permid, computed in SQL with `format_permid('OCC', occurrence_no)` for the batch, so check digits
  stay SQL-only (`prefixed-permids`).

Because the passes and batches run in a fixed order and nothing else draws on `OCC` or `ABD`, a rebuild from
`--createdb` mints the same numbers: `ABD-10000000` onward for abundances, `OCC-10000000` onward for
reidentifications.

### D4 — Classic `created` is not carried; load order is the tie-break

`created_at` is left to its default on every row, as every other migration leaves it, so it means the same
thing on every table: when the row was written in PostgreSQL. Classic's `created` and `modified` are not read.

The winner ranking does not need them. `NOW()` is fixed for a transaction, so every migrated row has the same
`created_at`, and `derive_occurrences()`'s tie-break falls through to the lineage's first id, which is load
order: roots in `occurrence_no` order, then reidentifications in `reid_no` order (D1). That is Classic's own
tie-break (`setMostRecentReID` orders `pubyr DESC, reid_no DESC`). Against ranking by Classic's `created`, it
changes the winner on 1 of the 33,370 reidentified occurrences (the one whose original was entered after its
reidentification). Rows entered in 2.0 later get both a later `created_at` and a higher id, so the two keys keep
agreeing. No change to the DDL or to `derive_occurrences()` is needed.

The migration must therefore keep both passes in one transaction, or at least run them in this order; it must
not load reidentifications before their roots or out of `reid_no` order.

*Alternative:* store Classic's `created` in `created_at` (the mapping document's rule 6). Rejected: it gives the
column a different meaning on this table alone, and puts doubtful values into it (inverted on 53% of rows, 6,409
before 1998, 99 zero dates, no recorded time zone).

*Alternative:* a `legacy_created_at` column. Rejected for this change: it needs a DDL change and a derive change
to be used, and collections, specimens, refs and opinions have all dropped Classic's dates already, so whether
to keep them is a decision for every table at once. It is recorded in `docs/api-design-backlog.md` ("Classic
entry dates"); this script can backfill such a column later from `oldpbdb_occurrence_no`/`oldpbdb_reid_no`.

The anomaly-report items about timestamps (inverted `modified < created`, pre-1998 `created`) therefore do not
apply to this migration.

### D5 — Resolution rules

| Column | Rule | Failure |
|---|---|---|
| persons | `resolvePersons()` (shared 0-sentinel rule); measured 0 hits | — |
| root `collection_id` | collection head by `legacyIDs.oldpbdbID` | not found → excluded (D2) |
| root `reference_id` | own `reference_no`, else the collection's `reference_id` (13) | none → abort |
| non-root `reference_id` | own `reference_no`, else the root's (0 measured; looked up on demand) | none → abort |
| `taxon_permid` | `loadNamePermidMap()`; 0/NULL → NULL | orphan (10) → NULL + anomaly, not abort |

The taxon rule differs from specimens, which aborts on an unresolvable taxon: here the verbatim name is always
in the payload and the mapping document asks for NULL plus a log line, as the merged schema allows.

### D6 — Payload builders are pure and exported

`buildIdentificationPayload(src, {reid})` and `buildAbundancePayload(src)` are exported for unit tests, as
`buildSpecimenPayload` is. They apply the mapping document: `''`/NULL → key omitted; the `"` ditto mark kept;
`plant_organ`, `plant_organ2` in that order into `plantOrgans`; NUL bytes stripped; `legacyIDs` as strings.
Each payload is validated against the resolved `db` variant before its batch is inserted; one failure aborts
with the row and the ajv errors.

### D7 — The runner step and the audit

- Step `occurrences`, row 12, after `taxa`, script `src/occurrences-migration/migrate-occurrences.js`, env
  `PG` and `MARIADB`. It writes and is first writer of `identifications`, `occurrence_abundances` and
  `occurrences`. Preconditions: those three empty; `collections` and `name_opinions` non-empty; some `refs`
  have `legacyIDs.oldpbdbID`. Appending keeps rows 1–11 unchanged (the runner spec's rule for additions).
  It does not depend on `taxa`, and could sit at row 11; it is appended because insertion would renumber `taxa`.
- The script itself asserts: roots + exclusions = source occurrences; non-roots + exclusions = source
  reidentifications; abundances = the count of loaded occurrences with a value or unit; and, after the
  rebuild, `occurrences` = roots loaded.
- Audit entities `identification` (`identifications.identification`, versioned) and `occurrence-abundance`
  (`occurrence_abundances.abundance`, versioned) join `src/audit-payloads.js` and the runner's
  `AUDIT_REGISTRY`. The derived `occurrences.identification` is a copy of a payload fragment, not a payload,
  and is not audited.

## Risks / Trade-offs

- [A 2.9M-row transaction with deferred exclusion constraints queues one check per row until COMMIT] →
  `name_opinions` loads about 1M rows under the same constraint today; measure memory and commit time on
  localhost first, and split into per-pass transactions only if it fails.
- [The tie-break depends on load order] → D1 fixes the order and D4 states it as a requirement; a run that
  loaded reidentifications first would hand every same-year tie to the root.
- [Classic's entry dates are not kept] → the same as every other table today; the backlog item covers whether
  to keep them everywhere.
- [A new dump changes the excluded set] → the CSV check fails the run rather than loading a different set.
- [Registry growth to about 5.3M rows and the rebuild's 82 s (synthetic, PG 17)] → measured on localhost and
  Aurora and recorded in the mapping document.
- [`rebuild_occurrences()` inside the transaction lengthens it] → accepted for atomicity (D1).
- [The 775-occurrence rule question is unresolved] → it lives in `derive_occurrences()`; if it changes, run
  `rebuild_occurrences()` again, with no reload.

## Migration Plan

1. Regenerate the two CSVs against `pbdb_2026_10_18`; update the mapping document's counts.
2. Write the script, its unit tests, the runner step and the audit entries.
3. On localhost: `--only occurrences` against the current database (which needs the new DDL first, so in
   practice a full `--createdb` run), then `audit-payloads.js`, then a second full rebuild to confirm permid
   determinism.
4. Rebuild Aurora `pbdb2_migration_test` (needs the VPN and the user's go-ahead) and compare counts with
   localhost.

Rollback is the transaction: a failed run writes nothing. A committed run is undone by rebuilding from
`--createdb`, as for every other step.

## Open Questions

- **Collection 27182.** Present in Classic, absent in PostgreSQL. Why the collections migration skipped it is
  not known yet; this change excludes its one occurrence and lists it, and the cause is a collections question.
- **The original-competes rule** (775 occurrences) is with Andrew; no effect on this change.
