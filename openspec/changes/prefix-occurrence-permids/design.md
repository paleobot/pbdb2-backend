## Context

`main` and this line split at `ee804f7` (tag `pre-prefixed-permids`). Since then this line moved
every table to prefixed permids (`adopt-prefixed-sequence-permids`, `collate-c-permids`), and Andrew
added `occurrences` on `main` (`create-occurrences-schema`) using the permid model he had: `permid
uuid` with the version-7 CHECK and `taxon_permid uuid`. The merge (da11057) brought his table in
unchanged, so it is now the only table on this line whose permid columns are uuids.

The table is empty everywhere: there is no occurrences migration script yet, only the mapping notes
in `migrations/src/occurrences-migration/docs/occurrences.md`. Andrew is not working on occurrences
now and expects to pull these changes later.

Classic numbers measured on `pbdb_2026_10_18`:

| | rows | numbers |
|---|---|---|
| `occurrences.occurrence_no` | 2,011,484 | 1 – 2,078,017 |
| `reidentifications.reid_no` | 35,492 | 1 – 43,526 |

The registry on localhost holds 2,452,458 permids (251 MB), 1,214,936 of them sequence-numbered
(`AOP` 944,933, `TXN` 256,555, `VOP` 11,467, `STA` 1,325, `CHR` 336, `REF` 241, `PRS` 71, `SCH` 8).

## Goals / Non-Goals

**Goals:**
- `occurrences` follows `prefixed-permids` like every other versioned table, so the occurrences
  migration can be written against its final shape.
- One sequence floor for every prefix, above every Classic number that becomes a permid, occurrences
  included.

**Non-Goals:**
- The occurrences migration script, or any occurrence data.
- Occurrence API routes.
- Renaming `taxon_permid` (it may become `name_opinions_permid` later, to match specimens).
- Bringing prefixed permids to `main`.
- Registry size or load speed. Occurrences will roughly double the registry; that is measured when
  the migration exists.

## Decisions

**D1. The prefix is `OCC`.** Classic's data service writes occurrences as `occ:N`, and `REF`,
`PRS`, `COL`, `SPM`, `INT` and `TSC` already follow its prefixes. Its digits are `241212`.

**D2. A migrated occurrence keeps its `occurrence_no`; a reidentification takes a sequence number.**
Migrated refs, persons, collections and specimens keep their Classic number, and occurrences
should too: `OCC-12345-35` is Classic occurrence 12345. A reidentification is its own row with its
own permid (Andrew's design: a taxonomic act, not a version), but `reid_no` (1 – 43,526) overlaps
`occurrence_no`, so it cannot be the number. It comes from the `OCC` sequence, and `reid_no` stays
in `legacyIDs.oldpbdbReidID` as the mapping notes already say.

Alternatives:
- A second prefix, `REI` (Classic's `rei:N`), for reidentifications. Rejected: one table would hold
  two prefixes, against "Each permid space has one prefix", and `OCC-5` and `REI-5` would share
  `permid_no` 5, so the one-head-per-number constraint would refuse them.
- Sequence numbers for every occurrence. Rejected: the Classic occurrence number, which users cite,
  would vanish from the permid, unlike every other Classic-numbered table.

**D3. Every sequence starts at 10,000,000, and `register_permids` accepts legacy numbers below it.**
`occurrence_no` reaches 2,078,017, past the old floor of 1,000,000, and `register_permids` refuses
legacy numbers at or above the floor. Raising the floor for every prefix keeps one floor and one
limit, and keeps the floor's two promises: minted and legacy permids cannot collide, and a minted
permid is visibly longer than a legacy one. Classic is still taking writes, so the floor needs room
above today's maximum; 10,000,000 leaves almost 8 million occurrence numbers.

Alternatives:
- A higher floor for `OCC` only. Rejected: it needs a per-prefix floor in both the sequence and
  `register_permids`, and a spec rule with an exception, for no gain while nothing outside our
  databases stores a permid.
- Sequence-only occurrences (D2's second alternative), which would avoid the floor question.

Cost: every sequence-numbered permid changes on the next rebuild (about 1.2 million on localhost).
Classic-numbered permids do not change. Permids minted from now on have an 8-digit number.

**D4. `taxon_permid` becomes a `TXN` permid column like `specimens.name_opinions_permid`.** `text
COLLATE "C"`, the `TXN` CHECK, and a foreign key to `permids`, not to `name_opinions` or `taxa`
(a permid is not unique on a versioned table). It holds a root name opinion's permid, the name as
spelled, which is also that name's `taxa.permid`. The column keeps Andrew's name for now. A note for
the migration: a root name opinion's number is the Classic `taxon_no`, so the script can format
`TXN-<taxon_no>` instead of looking up `name_opinions.oldpbdb_taxon_no`, but it still has to check
that the name exists (10 orphan rows → NULL).

**D5. The table gains `permid_no` and `occurrences_one_head_per_number`.** As on every versioned
table (`prefixed-permids` "Each table carries its permid's number for ordering"). The head index on
`permid` already comes from `install_version_triggers`; Andrew's other indexes are unchanged.

**D6. Rebuild, don't alter.** Localhost and Aurora are rebuilt from the DDL with the full runner.
`ALTER SEQUENCE … RESTART` in place would leave the permids already minted below 10,000,000 in the
data, mixing the two floors. A rebuild is also the only way the table definition changes, since the
DDL is the source.

Verification after the localhost rebuild, against the counts taken before it:
- every table's row count is unchanged;
- the set of permids below 1,000,000 (the Classic-numbered ones) is unchanged;
- no permid has a number from 1,000,000 to 9,999,999;
- per prefix, the count of permids at or above 10,000,000 equals the count at or above 1,000,000
  before; if minting is deterministic, each number is the old one plus 9,000,000;
- `taxa` has the same row count, and the payload checks of the last rebuild (refs, authorities,
  collections, specimens) still match where the payloads hold no sequence permid.

## Risks / Trade-offs

- [Sequence-numbered permids written down somewhere go stale] → In the repository only
  `api/test/integration/permids.test.js` and two specs name one (`SCH-1000000-26`); they are
  updated here. Scratch reports and notes outside the repository are not.
- [Classic outgrows the floor] → 10,000,000 is almost five times today's largest Classic number,
  and `register_permids` refuses a number at the floor loudly rather than colliding.
- [`main` and this line diverge further] → `main` still has uuid occurrences. When the lines
  converge, this change's DDL wins for `occurrences`; Andrew knows he will pull it.
- [Andrew's archived change still says uuidv7] → It is history and stays as written; the synced
  `occurrence-schema` spec and the mapping notes are what count.
- [Aurora rebuild needs the VPN and takes about 40 minutes] → Done last, after localhost is
  verified.

## Migration Plan

1. Change the DDL, tests, specs and docs; run the unit and integration suites.
2. Rebuild localhost with the full runner and run the checks in D6.
3. Rebuild Aurora `pbdb2_migration_test` (VPN) and compare its counts and permid checks with
   localhost.

Rollback: revert the commit and rebuild. Nothing outside our databases holds a permid.

## Open Questions

None.

## Verification

Localhost `pbdb`, rebuilt 2026-11-19 at 16ec2d1 plus this change's working tree, with
`node src/run-migrations.js --createdb` (all 11 steps, audit clean, 10m43s). The database before it
was kept as `pbdb_pre_floor10m` (built at d700308, before the occurrences merge). Snapshot, check
script and output: the session scratchpad (`check-d6.sh`, `check-d6-localhost.txt`).

The Context figure 1,215,436 was an addition slip; the per-prefix counts sum to 1,214,936, which is
what the registry held.

| Check (D6) | Result |
|---|---|
| Row count of every table (47 before) | unchanged; the one difference is the new `occurrences`, 0 rows (absent before) |
| md5 of the sorted permids numbered below 1,000,000 | `269c0f16…ff98` before and after |
| Permids numbered 1,000,000 – 9,999,999 | 0 |
| Per prefix, count at or above 10,000,000 vs at or above 1,000,000 before | equal for all eight: `AOP` 944,933, `TXN` 256,555, `VOP` 11,467, `STA` 1,325, `CHR` 336, `REF` 241, `PRS` 71, `SCH` 8; each range is the old one shifted by 9,000,000 |
| Each sequence permid is the old one plus 9,000,000 | yes, all 1,214,936: every expected permid is registered, and no other permid at or above 10,000,000 exists. Minting is deterministic |
| `occurrences` | exists, empty; `permid` and `taxon_permid` are `text`, collation `C`; no public `*permid` column is `uuid` |
| Table contents vs `pbdb_pre_floor10m` | identical for all 20 populated or empty data tables (`refs`, `persons`, `authorities`, `collections`, `specimens`, `schemas`, `characters`, `states`, both child-ref tables, the four opinion tables, `homonyms`, `taxa`, `taxa_linnaean`, `taxa_clades`, `taxa_attachments`, `cycle_cuts`): md5 of each row's jsonb minus `id`, version links, `created_at` and `permid_no`, after mapping every old 7-digit sequence permid to its number plus 9,000,000. FK ids repeat too |

Suites: `npm test` (root) 149 + 126 pass; `npm run test:integration` 78 pass; none skipped.

**Aurora** `pbdb2_migration_test`, rebuilt 2026-11-19 at 6357625 in place (DROP/CREATE,
`CREATE EXTENSION postgis` 3.6.3, runner `--createdb`; all 11 steps, audit clean, 37m31s), compared
with the rebuilt localhost:

| Check | Result |
|---|---|
| Row counts (48 tables) | identical |
| Legacy permids (1,237,522), sequence permids (1,214,936), per-prefix counts | identical md5 and counts |
| Permids numbered 1,000,000 – 9,999,999; `uuid` permid columns | 0 on both |
| `occurrences` | empty on both; `permid` and `taxon_permid` are `text`, collation `C` |
| Table contents (same 21 tables, rows sorted bytewise) | identical for every table except `collections` |
| `collections` | payload and every other column identical. `location` differs on 1,039 rows (1,022 NAD27 CONUS, 16 NAD83, 1 WGS72), mean 12.7 m, max 30 m |

The `location` difference is not this change's. Those rows are reprojected to WGS84 by
`ST_Transform` in `migrate-collections.js`, and the two servers run different PROJ (localhost
PostGIS 3.4.2 / PROJ 9.4.0, Aurora 3.6.3 / PROJ 9.5.0), so they pick different datum
transformations. Localhost reproduced its own locations exactly across the rebuild. Earlier
Aurora comparisons checked payloads, not `location`, so this is the first time it shows.
