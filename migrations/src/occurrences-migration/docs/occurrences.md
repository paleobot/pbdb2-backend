# Classic occurrences + reidentifications → 2.0 `identifications`, `occurrence_abundances` [‡]

Every row of classic `occurrences` (2,011,484) and `reidentifications` (35,492) becomes one `identifications` row,
and each occurrence that records a count also becomes one `occurrence_abundances` row. The 2.0 `occurrences` table is
**not loaded**: it is a cache that `rebuild_occurrences()` derives from the identifications, as `taxa` is derived from
`name_opinions`.

Targets: `db/02-core.sql` (`identifications`, `occurrence_abundances`) and `db/03-taxa.sql` (`occurrences`,
`derive_occurrences()`, `rebuild_occurrences()`). Payloads: `payloadSchemas/identification.schema.js` and
`payloadSchemas/occurrenceAbundance.schema.js`. Rationale and the measurements behind every line here:
`openspec/changes/replace-occurrences-with-identifications/design.md` (and, for the source profiling, the archived
`create-occurrences-schema/design.md`).

```
 Classic occurrences ──┬─► identifications   root row      (occurrence_permid = permid, collection_id set)
                       └─► occurrence_abundances           (when abund_value or abund_unit is non-empty)
 Classic reidentifications ─► identifications   non-root row  (occurrence_permid = the root's permid)

 rebuild_occurrences()  ─►  occurrences   (one row per root; winner by latest reference)
```

## Root identifications (from `occurrences`)

| 2.0 column / payload field | Classic source | Notes |
| --- | --- | --- |
| `permid` | `occurrence_no` | `register_permids('OCC', …)` → `OCC-<occurrence_no>-<CC>`, in batches (`prefixed-permids`). Becomes the occurrence's permid |
| `occurrence_permid` | — | the same value as `permid`: that is what makes the row the root |
| `authorizer_person_id`, `enterer_person_id` | `authorizer_no`, `enterer_no` | resolves to `persons.id` = `person_no` through `resolvePersons()`. No migrated row holds `0`, so the shared 0-sentinel never fires |
| `collection_id` | `collection_no` | via collections `legacyIDs.oldpbdbID`. **NOT NULL** on the root. The 626 occurrences with no PostgreSQL collection (621 zero, 4 absent from Classic, 1 in collection 27182, which Classic has but was not migrated) are not migrated: see "Excluded rows" |
| `taxon_permid` | `taxon_no` | the `TXN` permid of the root name opinion. Its number is the Classic `taxon_no`, so this is `TXN-<taxon_no>-<CC>` (format with `format_permid('TXN', …)`), but only after checking the root name opinion exists (`name_opinions.oldpbdb_taxon_no`). `0` and NULL are both unset (51,339 + 0 among migrated rows) → NULL. 10 rows (2 distinct values, 62702 and 67942) are orphans → NULL, logged |
| `reference_id` | `reference_no` | via refs `legacyIDs.oldpbdbID`. **NOT NULL.** When unset or not in `refs` (13 rows, all `reference_no = 0`), use the collection's reference |
| `oldpbdb_occurrence_no` | `occurrence_no` | |
| `oldpbdb_reid_no` | — | NULL |
| `created_at` | — | not carried: the column default (the load time), as on every other migrated table. See rule 6 |
| `identification.legacyIDs.oldpbdbID` | `occurrence_no` | |
| `identification.identification.<rank>.resolution` | `genus_reso`, `subgenus_reso`, `species_reso`, `subspecies_reso` | NULL and `''` → key omitted. Keep `"` verbatim |
| `identification.identification.<rank>.name` | `genus_name`, `subgenus_name`, `species_name`, `subspecies_name` | NULL and `''` → key omitted |
| `identification.plantOrgans` | `plant_organ`, `plant_organ2` | in that order; `''`/NULL dropped; omit the key if empty |
| `identification.comments` | `comments` | NULL and `''` → omitted |

## Abundances (from `occurrences`)

One `occurrence_abundances` row for each migrated occurrence whose `abund_value` or `abund_unit` is non-empty:
807,678 with a value plus 1,171 with a unit and no value = **808,849**. A unit with no value carries little, but it
is data, so it is kept rather than dropped.

| 2.0 column / payload field | Source | Notes |
| --- | --- | --- |
| `permid` | minted | `mint_permids('ABD', …)`, numbered from 10,000,000: Classic has no abundance number |
| `occurrence_permid` | the root identification's `permid` | an `OCC` permid; an FK to the registry |
| `authorizer_person_id`, `enterer_person_id`, `reference_id` | the occurrence's, as resolved for the root | Classic recorded no separate authorship, so the abundance copies the occurrence's. The reference includes the collection fallback |
| `created_at` | — | not carried (rule 6) |
| `abundance.legacyIDs.oldpbdbID` | `occurrence_no` | |
| `abundance.value`, `abundance.unit` | `abund_value`, `abund_unit` | NULL and `''` → key omitted. Both stay text (`value` is not always a number) |

At most one abundance lineage may exist per occurrence; the table enforces it.

## Non-root identifications (from `reidentifications`)

| 2.0 column / payload field | Classic source | Notes |
| --- | --- | --- |
| `permid` | — | minted: `mint_permids('OCC', …)`, numbered from 10,000,000. `reid_no` overlaps `occurrence_no`, so it is not the number |
| `occurrence_permid` | the root's `permid` | found through `occurrence_no`. The 15 reidentifications whose occurrence does not exist (or is excluded) are not migrated |
| `collection_id` | — | **NULL.** Only the root carries the collection. The reidentification's own `collection_no` is ignored; see "Collection conflicts" |
| `taxon_permid` | the reidentification's own `taxon_no` | as for roots; 428 zeros → NULL, no orphans |
| `reference_id` | the reidentification's own `reference_no` | else the root's `reference_id`; none needed on `pbdb_2026_10_18` |
| persons | the reidentification's own `authorizer_no`, `enterer_no` | not inherited from the occurrence |
| `oldpbdb_occurrence_no` | `occurrence_no` | the same value as the root's |
| `oldpbdb_reid_no` | `reid_no` | |
| `created_at` | — | not carried (rule 6) |
| `identification.legacyIDs.oldpbdbID`, `.oldpbdbReidID` | `occurrence_no`, `reid_no` | |
| `identification.identification`, `.comments` | as for roots | |
| `identification.plantOrgans` | `plant_organ` | no second organ column |

There is nothing for abundance here: `reidentifications` has no abundance columns.

## What the derived `occurrences` row is

`rebuild_occurrences()` produces one row per root whose head is not removed (expect **2,010,858** after this load),
with the root's `collection_id`, `reference_id` and `oldpbdb_occurrence_no`, and:

- the **winning identification**: the one citing the reference with the latest `publicationYear`, undated references
  last; ties go to the lineage entered most recently (`created_at`, NULL last; equal on every migrated row, see rule 6), then the highest lineage id;
- that identification's `taxon_permid` and name block (`identification`);
- `plant_organs` from the highest-ranked identification that has any, so a reidentification silent about the organs
  does not erase them.

On the older Postgres mirror (2026-11-23) the winner differed from "most recently entered" on 1,360 of the 32,979
occurrences that had reidentifications (770 of them going to the original identification), and 1,104 shared a top
year so entry time decided.

Against Classic's own rule (see rule 2) the only difference is that the original identification competes. On
`pbdb_2026_10_18` that gives a different winner on 775 of 33,370 reidentified occurrences (712 resolve to a different
taxon); every other winner, tie-breaks included, is Classic's. **Open (2026-11-24):** whether the original should
compete is with Andrew; changing it is one ORDER BY term in `derive_occurrences()` and does not affect this load.

Measured after the load (2026-11-24, localhost): of the 33,355 reidentified occurrences that were migrated (the
33,370 less the 15 whose occurrence does not exist), a reidentification wins on 32,581, every one Classic's rule's
pick, including the 17 whose stored `YES` is stale; the original wins on **774**. The 775 above ranked by Classic's
`created`; with load order as the tie-break (rule 6) the one occurrence whose original was entered after its
reidentification goes to Classic's winner.

## Rules the migration must follow

1. **Never choose a current identification.** There is no flag and no filter. Load every row as an identification; the
   winner is derived.
2. **Do not read `occurrences.reid_no` or `reidentifications.most_recent`.** `reid_no` is NULL on 9,070 occurrences
   that have reidentifications and dangles or mismatches on 16 more. `most_recent` is not arbitrary: it is Classic's
   `setMostRecentReID` rule (latest reference `pubyr`, then latest `reid_no`, original never a candidate), which is
   why the `YES` row is often not the last one entered (554 chains on `pbdb_2026_10_18`; 549 of them are exactly the
   rule's pick). It goes stale when a reference's year is edited (17 occurrences), and `derive_occurrences()` computes
   the same ranking live, so neither column is needed: nothing orders or heads a chain at load time any more, and rows
   can be inserted in any order. See `reidentification-current-rule.md`.
3. **`0` and NULL are one condition** on every foreign-key column.
4. **Exclude, do not load, the rows in `docs/occurrences-excluded.csv`** (see below), and assert the count.
5. **Reference fallback.** For a root whose `reference_no` is unset or unresolvable, use its collection's reference
   (13 rows); for a reidentification whose reference is unresolvable, use the root's (0 rows). Fail the run if a
   remaining row has no reference.
6. **`created_at` and load order:** do not carry Classic's `created` or `modified`; let `created_at` default.
   Every migrated row then has the same `created_at` (one transaction), so the winner tie-break falls to the
   lineage's first id, which is load order. Load roots in `occurrence_no` order, then reidentifications in
   `reid_no` order: that is Classic's own tie-break (`pubyr DESC, reid_no DESC`), and it differs from ranking
   by Classic's `created` on 1 occurrence. Decided 2026-11-24 (`create-occurrences-migration` D4); whether to
   keep Classic entry dates at all is the backlog item "Classic entry dates".
7. **Resolutions:** map `''` and NULL to "key omitted"; keep `"` verbatim.
8. **Log the 12 collection conflicts** (below) and the 10 unresolvable `taxon_no` rows.
9. **After the load, call `rebuild_occurrences()` once**, then assert the `occurrences` count equals the number of
   root identifications loaded.
10. **Do not backfill `specimens.name_opinions_permid`** from occurrences unless asked.

## Targets

| Table | Rows |
| --- | --- |
| `identifications` | 2,011,484 − 626 = **2,010,858** roots + 35,492 − 15 = **35,477** non-roots (on 33,355 occurrences) = **2,046,335** |
| `occurrence_abundances` | **808,849** |
| `occurrences` (derived) | **2,010,858** |

## Measured load

All targets above were met exactly, with no payload violations and a clean round trip; the 641 excluded rows and
12 conflicts matched the CSVs.

| | localhost `pbdb` (PG 16.15), 2026-11-24 | Aurora `pbdb2_migration_test` (PG 18.3), 2026-11-25 |
| --- | --- | --- |
| Step total | 356.5 s | 2,278.0 s |
| Pass 1: roots + abundances | 260.5 s | 2,021.7 s (network round trips per batch) |
| Pass 2: non-roots | 4.9 s | 30.1 s |
| `ANALYZE identifications` | 0.3 s | 0.3 s |
| `rebuild_occurrences()` | 88.6 s (85.1–94.0 s over four runs; 36.5 s with nested loops off, as the script now runs it) | 217.7 s (nested loops off) |
| COMMIT (deferred one-head checks) | 0.0 s | 0.1 s |
| Peak RSS of the script | 470 MB | 337 MB |
| Full runner, 12 steps | 17 min 31 s | about 94 min (steps 1–11 56 min, then the step re-run alone) |
| Registry `permids` | 2,452,459 → 5,307,643 (+2,046,335 `OCC`, +808,849 `ABD`) | the same |
| Sizes: `identifications` / `occurrence_abundances` / `occurrences` / `permids` | 1,058 / 264 / 801 / 542 MB | 1,063 / 264 / 782 / 552 MB |
| Database | 4,550 MB | 4,548 MB |

First minted permids: `OCC-10000000-29` (reidentification 1) and `ABD-10000000-93` (occurrence 1). Two rebuilds
from `--createdb` gave identical permids on every row. Aurora matches localhost on every identification and abundance
permid, on md5s of the identification and abundance rows (payload, taxon, reference, collection, persons) and of the
derived occurrences (winner, name block, organs), and on the registry count.

The Aurora figure is from a re-run of the step alone. The first attempt's `rebuild_occurrences()` took a nested-loop
plan on PG 18 and was stopped after 31 min (design.md, Risks); it rolled back, the two sequences were reset with
`ALTER SEQUENCE … RESTART` (no minted permid was registered), and the step re-run with nested loops off.

## Collection conflicts

Conceptually an occurrence never changes collection, and only the root carries one. In Classic, 12 of the 35,477
reidentifications name a different `collection_no` from their occurrence. They are listed, with both collections,
both references, both names and both enterers, in `docs/occurrences-collection-conflicts.csv`.

Seven belong to one pair, collections 57958 and 122362, which point at each other (occurrence 558371 is in 122362 and
its reidentification in 57958; 558379 is the reverse), which looks like a bulk move or swap. The other five were entered
minutes after their occurrence, which looks like a slip within one session. Nothing in the data says which side is
right, so the migration uses the occurrence's collection and leaves the 12 for a curator.

## Excluded rows

An occurrence has no meaning outside its collection (`collection_id` is NOT NULL on the root), so 626 source occurrences
and 15 reidentifications are not migrated. Whether an occurrence is loaded is decided against PostgreSQL, not Classic: its
`collection_no` must resolve to a `collections` head. `docs/occurrences-excluded.csv` lists each excluded row with a
category, and the migration fails before COMMIT if the rows it excludes are not exactly the rows the file lists:

| Category | Rows | Meaning |
| --- | --- | --- |
| `tombstone` | 594 | Classic blanked these when it deleted a collection; the comment records ` was collection_no N reference_no M` |
| `blank-placeholder` | 21 | empty genus, no taxon, `collection_no = 0` |
| `test-data` | 3 | orphan collections 9590 and 10463 (`Crapphyllum shitvillensis`, `Big cow`) |
| `collection-deleted` | 1 | a real taxon whose collection no longer exists (occurrence 520036, collection 52944) |
| `collection-lost` | 6 | P. Wagner, reference 13541, no collection recorded: **needs human curation**, 12 candidate collections |
| `collection-not-migrated` | 1 | occurrence 285891 (*Cooksonia* sp.) in collection 27182, which Classic has but the collections step skipped |
| `orphan-reidentification` | 15 | a reidentification whose occurrence does not exist |

The query also has a category `occurrence-excluded` for a reidentification of an excluded occurrence; there are none.

Against the mirror list, occurrence 926337 is no longer excluded (the dump gives it collection 122352, which exists), so
no specimen now points at an excluded occurrence; 285891 is new.

**Collection 27182.** Classic `collections` has it (*Lochkov-Kalke, Pridoli-Schichten, Czech Republic*, reference 6340),
but its `country` is empty (`state` is `Bohemia`), so `migrate-collections.js` skips it as "no toponym match"
(`resolveToponym` returns `no country`). It is the one collection in Classic and not in PostgreSQL (279,600 vs.
279,599 heads). Fixing it is a collections question, not this migration's; when it is migrated, its occurrence leaves
the CSV and the run's check says so.

### How the two CSVs are generated

Both are generated on MariaDB `pbdb_2026_10_18` and written with Python's `csv` module (minimal quoting). `created`
is Classic's `datetime`, read as MST (UTC−7, the server's zone) and written as UTC. The excluded list needs the
PostgreSQL collection heads, loaded into a MariaDB temporary table first:

```sql
-- PostgreSQL:
SELECT collection->'legacyIDs'->>'oldpbdbID' FROM collections
WHERE succeeded_by_id IS NULL AND collection->'legacyIDs' ? 'oldpbdbID';
-- MariaDB, same session as the query below:
CREATE TEMPORARY TABLE pg_collections (collection_no int unsigned PRIMARY KEY);
INSERT INTO pg_collections VALUES (...);  -- the numbers above
```

`docs/occurrences-excluded.csv`:

```sql
-- Occurrences and reidentifications the occurrences migration does not load.
-- Needs pg_collections(collection_no): the oldpbdbIDs of the PostgreSQL collection heads.
WITH occ AS (
  SELECT o.*,
         REGEXP_SUBSTR(o.comments, '(?<= was collection_no )[0-9]+(?= reference_no [0-9]+$)') AS was_collection_no,
         REGEXP_SUBSTR(o.comments, '(?<= reference_no )[0-9]+$') AS was_reference_no,
         c.collection_no AS classic_collection,
         pc.collection_no AS pg_collection
  FROM occurrences o
  LEFT JOIN collections c ON c.collection_no = o.collection_no
  LEFT JOIN pg_collections pc ON pc.collection_no = o.collection_no
),
excluded_occ AS (
  SELECT occ.*,
    CASE
      WHEN COALESCE(collection_no, 0) = 0 AND was_collection_no IS NOT NULL THEN 'tombstone'
      WHEN COALESCE(collection_no, 0) = 0 AND reference_no = 13541 THEN 'collection-lost'
      WHEN COALESCE(collection_no, 0) = 0 AND genus_name = '' THEN 'blank-placeholder'
      WHEN collection_no IN (9590, 10463) THEN 'test-data'
      WHEN classic_collection IS NULL AND COALESCE(collection_no, 0) <> 0 THEN 'collection-deleted'
      WHEN classic_collection IS NOT NULL THEN 'collection-not-migrated'
    END AS category
  FROM occ
  WHERE pg_collection IS NULL
)
SELECT 'occurrences' AS source_table, occurrence_no AS source_no, occurrence_no, '' AS reid_no, category,
       collection_no, reference_no, COALESCE(was_collection_no, '') AS was_collection_no,
       COALESCE(was_reference_no, '') AS was_reference_no, genus_name, species_name, COALESCE(enterer, '') AS enterer,
       DATE_FORMAT(CONVERT_TZ(created, '-07:00', '+00:00'), '%Y-%m-%dT%H:%i:%s.000Z') AS created,
       CASE category
         WHEN 'tombstone' THEN 'Classic blanked this row when its collection was deleted'
         WHEN 'collection-lost' THEN 'reference 13541 has 12 collections (50546 50547 50548 50549 50550 50551 56966 56967 56968 56969 56970 99940); same-batch neighbour occurrence 499207 is in collection 50549'
         WHEN 'collection-not-migrated' THEN 'collection exists in Classic but was not migrated (empty country)'
         ELSE ''
       END AS note
FROM excluded_occ
UNION ALL
SELECT 'reidentifications', r.reid_no, r.occurrence_no, r.reid_no,
       CASE WHEN eo.occurrence_no IS NULL THEN 'orphan-reidentification' ELSE 'occurrence-excluded' END,
       r.collection_no, r.reference_no, '', '', r.genus_name, r.species_name, COALESCE(r.enterer, ''),
       DATE_FORMAT(CONVERT_TZ(r.created, '-07:00', '+00:00'), '%Y-%m-%dT%H:%i:%s.000Z'), ''
FROM reidentifications r
LEFT JOIN occurrences o ON o.occurrence_no = r.occurrence_no
LEFT JOIN excluded_occ eo ON eo.occurrence_no = r.occurrence_no
WHERE o.occurrence_no IS NULL OR eo.occurrence_no IS NOT NULL
ORDER BY source_table DESC, source_no;
```

`docs/occurrences-collection-conflicts.csv` (the names join resolution and name, leaving out `informal`):

```sql
-- Reidentifications naming a different collection from their occurrence.
SELECT o.occurrence_no, r.reid_no,
       o.collection_no AS occ_collection_no, r.collection_no AS reid_collection_no,
       o.reference_no AS occ_reference_no, r.reference_no AS reid_reference_no,
       DATE_FORMAT(CONVERT_TZ(o.created, '-07:00', '+00:00'), '%Y-%m-%dT%H:%i:%s.000Z') AS occ_created,
       DATE_FORMAT(CONVERT_TZ(r.created, '-07:00', '+00:00'), '%Y-%m-%dT%H:%i:%s.000Z') AS reid_created,
       CONCAT_WS(' ', NULLIF(NULLIF(o.genus_reso, ''), 'informal'), o.genus_name,
                 IF(o.subgenus_name <> '', CONCAT('(', o.subgenus_name, ')'), NULL),
                 NULLIF(NULLIF(o.species_reso, ''), 'informal'), o.species_name) AS occ_name,
       CONCAT_WS(' ', NULLIF(NULLIF(r.genus_reso, ''), 'informal'), r.genus_name,
                 IF(r.subgenus_name <> '', CONCAT('(', r.subgenus_name, ')'), NULL),
                 NULLIF(NULLIF(r.species_reso, ''), 'informal'), r.species_name) AS reid_name,
       o.enterer AS occ_enterer, r.enterer AS reid_enterer
FROM reidentifications r
JOIN occurrences o ON o.occurrence_no = r.occurrence_no
WHERE r.collection_no <> o.collection_no
ORDER BY o.occurrence_no, r.reid_no;
```

[‡] Counts measured 2026-11-24 on MariaDB `pbdb_2026_10_18` against localhost `pbdb` (collections, refs and name opinions
as migrated); both CSVs regenerated the same day. Earlier figures came from the Postgres-ported classic mirror.
