## Why

The target schema for occurrences is settled (`replace-occurrences-with-identifications` and
`port-identifications-to-prefixed-permids`, both archived 2026-11-23), but nothing loads it: Classic's 2.0M
occurrences and 35K reidentifications, the largest body of data not yet migrated, are still only in MariaDB.
The mapping document (`src/occurrences-migration/docs/occurrences.md`) exists; its counts come from an older
Postgres mirror and need re-measuring against `pbdb_2026_10_18` before a script can assert them.

## What Changes

- Add `src/occurrences-migration/migrate-occurrences.js`, which reads MariaDB `occurrences` and
  `reidentifications` and writes:
  - one **root** `identifications` row per occurrence with a resolvable collection, permid
    `OCC-<occurrence_no>-<CC>` registered from the Classic number;
  - one **non-root** `identifications` row per reidentification whose occurrence was loaded, permid minted from
    the `OCC` sequence (never from `reid_no`, which overlaps `occurrence_no`);
  - one `occurrence_abundances` row per loaded occurrence with a non-empty `abund_value` or `abund_unit`,
    permid minted from the `ABD` sequence in a fixed order so reruns produce the same permids;
  - then calls `rebuild_occurrences()` once to fill the derived `occurrences` cache.
- Never choose a current identification at load time: every identification is loaded and the winner is
  derived. The open question of whether the original identification competes (775 occurrences, with Andrew
  since 2026-11-24) lives only in `derive_occurrences()` and does not affect this load.
- Re-measure every count and regenerate `docs/occurrences-excluded.csv` and
  `docs/occurrences-collection-conflicts.csv` against `pbdb_2026_10_18`. Measured so far: 2,011,484
  occurrences (626 with no collection in PostgreSQL: 625 absent in Classic too, plus collection 27182, which
  Classic has but was not migrated), 35,492 reidentifications (15 whose occurrence does not exist), 808,849
  abundances and 12 collection conflicts.
- Add the step to the migration runner, appended after `taxa`, with count assertions.
- Register the identification and occurrence-abundance payloads with the payload audit.
- Update `occurrences.md` with the new counts and anything the script settles.
- Rebuild localhost, then Aurora `pbdb2_migration_test`, with the new step.

## Capabilities

### New Capabilities
- `occurrence-migration`: source extraction from `occurrences` and `reidentifications`, the root / non-root
  split, permid registration and minting, foreign-key resolution (persons, collections, refs, `TXN` taxon
  permids), the exclusion and fallback rules, payload construction and validation, the abundance rows, the
  load order the winner tie-break relies on, the `rebuild_occurrences()` call, and anomaly reporting.

### Modified Capabilities
- `migration-runner`: a new step `occurrences` (row 12, after `taxa`) and its dependency edges and assertions.
- `payload-audit`: `identification` (`identifications.identification`) and `occurrence-abundance`
  (`occurrence_abundances.abundance`) become audited entities.

## Impact

- **Source (MariaDB `pbdb_2026_10_18`):** `occurrences`, `reidentifications`; read-only joins to
  `collections` and `refs` for exclusions and fallbacks.
- **Target (PostgreSQL):** `identifications`, `occurrence_abundances`, `permids` (about 2.86M new rows:
  roughly 2.05M `OCC` + 0.81M `ABD`), and the derived `occurrences`. Reads `persons`, `collections`, `refs`
  and `name_opinions` written by earlier steps.
- **Type mappings:** `occurrence_no` → `OCC` permid number; `collection_no`, `reference_no` → `bigint` ids via
  `legacyIDs.oldpbdbID`; `taxon_no` → `TXN` permid text via `name_opinions.oldpbdb_taxon_no`;
  `authorizer_no`/`enterer_no` → `persons.id`; `created`/`modified` → not carried (`created_at` is the load
  time, as on every other table);
  `*_reso`/`*_name`, `plant_organ(2)`, `comments` → the identification jsonb payload; `abund_value`,
  `abund_unit` → the abundance payload as text.
- **Anomalies (`mariadb/PBDBLegacy-DeepAnalysis/anomaly-report.md`):**
  - inverted timestamps (`modified < created` on 1,069,928 occurrences, 53%), `created` before PBDB existed
    (6,422 in the report) and 99 zero dates: not applicable, because neither column is carried;
  - NULL vs `''` in `*_reso` and the `"` ditto mark (11,040 rows): `''`/NULL → key omitted, `"` kept;
  - `taxon_no = 0` (about 52.8K) and 10 orphan `taxon_no` → NULL `taxon_permid`, names kept in the payload;
  - orphans: 15 reidentifications without an occurrence, 11 occurrence `reference_no`, 5 `collection_no`.
- **Code:** `src/run-migrations.js`, `src/audit-payloads.js`, a new `src/occurrences-migration/` script;
  possibly shared helpers in `src/lib/` (`loadNamePermidMap` already exists).
- **Data-integrity risks:**
  - the winner tie-break falls to load order (the lineage's first id) because every migrated row shares one
    `created_at`; roots must load before reidentifications, and both in Classic number order;
  - permids: a root must be registered from `occurrence_no`, and reidentifications and abundances minted; a
    collision or an unregistered permid fails the registry FK and CHECK;
  - the 626 + 15 excluded rows and the 12 collection conflicts must be listed, not silently dropped;
  - runtime and size: `rebuild_occurrences()` was 82 s on a 2M synthetic load; the registry grows to
    roughly 5.3M rows. Both are measured on localhost and Aurora.
- **No API or DDL change.**
