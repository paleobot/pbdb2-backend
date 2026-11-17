# Classic occurrences + reidentifications → 2.0 `occurrences` [‡]

Every row of classic `occurrences` (1,984,733) and `reidentifications` (35,098) becomes one `occurrences` row.
Target: `db/02-core.sql`; payload: `payloadSchemas/occurrence.schema.js`; rationale and the measurements
behind every line here: `openspec/changes/create-occurrences-schema/design.md`.

## Occurrence rows (from `occurrences`)

| 2.0 column / payload field | Classic source | Notes |
| --- | --- | --- |
| `permid` | minted | uuidv7 |
| `authorizer_person_id`, `enterer_person_id` | `authorizer_no`, `enterer_no` | resolves to `persons.id` = `person_no`. The 20 rows holding `0` are all excluded blank placeholders, so no fallback is needed |
| `taxon_permid` | `taxon_no` | via `name_opinions.oldpbdb_taxon_no`. `0` and NULL are both unset (52,787 + 7, less the excluded rows) → NULL. 10 rows (2 distinct values) are orphans → NULL, logged |
| `collection_id` | `collection_no` | via collections `legacyIDs.oldpbdbID`. **NOT NULL.** The 626 occurrences with no resolvable collection (621 zero + 5 orphan) are not migrated: see "Excluded rows" |
| `reference_id` | `reference_no` | via refs `legacyIDs.oldpbdbID`. **NOT NULL.** When unset or not in `refs` (11 rows), use the collection's reference |
| `reidentifies_id` | — | NULL: an occurrence is the first identification |
| `oldpbdb_occurrence_no` | `occurrence_no` | |
| `oldpbdb_reid_no` | — | NULL |
| `created_at` | `created` | 66 rows are NULL: pass an explicit NULL, do not let the default stamp the migration time |
| `occurrence.legacyIDs.oldpbdbID` | `occurrence_no` | |
| `occurrence.identification.<rank>.resolution` | `genus_reso`, `subgenus_reso`, `species_reso`, `subspecies_reso` | NULL and `''` → key omitted. Keep `"` verbatim |
| `occurrence.identification.<rank>.name` | `genus_name`, `subgenus_name`, `species_name`, `subspecies_name` | NULL and `''` → key omitted |
| `occurrence.abundance.value` / `.unit` | `abund_value`, `abund_unit` | NULL and `''` → key omitted |
| `occurrence.plantOrgans` | `plant_organ`, `plant_organ2` | in that order; `''`/NULL dropped; omit the key if empty |
| `occurrence.comments` | `comments` | NULL and `''` → omitted |

Not migrated: `modified`, `updated`, `modifier_no`, `updater_no`, `authorizer`, `enterer`, `modifier`
(denormalized text), `upload`, `upload_id`, and **`reid_no`** (see below).

## Reidentification rows (from `reidentifications`)

Same as above except:

| 2.0 column / payload field | Classic source | Notes |
| --- | --- | --- |
| `reidentifies_id` | — | the previous row of the chain: the occurrence for the first reidentification, else the previous reidentification, ordered by `reid_no` ascending |
| `oldpbdb_occurrence_no` | `occurrence_no` | the same value as the chain's root |
| `oldpbdb_reid_no` | `reid_no` | |
| `occurrence.legacyIDs.oldpbdbReidID` | `reid_no` | |
| `taxon_permid`, `collection_id`, `reference_id`, persons | the reidentification's **own** `taxon_no`, `collection_no`, `reference_no`, `authorizer_no`, `enterer_no` | not inherited from the occurrence: 452 zero taxa; every collection is set; 1 reference orphan → the reidentification's collection's reference |
| `occurrence.abundance` | — | absent from `reidentifications` |
| `occurrence.plantOrgans` | `plant_organ` | no second organ column |
| `occurrence.comments` | `comments` | |

## Rules the migration must follow

1. **Never choose a current identification.** No flag, no filter. The chain head is derived at read time.
2. **Do not trust `occurrences.reid_no` or `reidentifications.most_recent`.** `reid_no` is NULL on 9,070
   occurrences that have reidentifications and dangles or mismatches on 16 more. In 555 of 1,802
   multi-reidentification chains the `most_recent = 'YES'` row is not the chronologically last one. Order a chain by
   `reid_no` (equal to `created` order in all 1,802) and log the 555.
3. **`0` and NULL are one condition** on every foreign-key column.
4. **Exclude, do not load, the rows in `docs/occurrences-excluded.csv`** (see below), and assert the count.
5. **Target count:** 1,984,733 − 626 = 1,984,107 occurrences + 35,098 − 15 = 35,083 reidentifications =
   2,019,190 rows.
6. **Do not backfill `specimens.name_opinions_permid`** from occurrences unless asked.

## Excluded rows

An occurrence has no meaning outside its collection (`collection_id` is NOT NULL), so 626 source occurrences
and 15 reidentifications are not migrated. `docs/occurrences-excluded.csv` lists each with a category:

| Category | Rows | Meaning |
| --- | --- | --- |
| `tombstone` | 594 | Classic blanked these when it deleted a collection; the comment records ` was collection_no N reference_no M` |
| `blank-placeholder` | 21 | empty genus, no taxon, `collection_no = 0` |
| `test-data` | 3 | orphan collections 9590 and 10463 (`Crapphyllum shitvillensis`, `Big cow`) |
| `collection-deleted` | 2 | real taxa whose collection no longer exists |
| `collection-lost` | 6 | P. Wagner, reference 13541, no collection recorded: **needs human curation**, 12 candidate collections |
| `orphan-reidentification` | 15 | a reidentification whose occurrence does not exist |

Specimen 20612 references excluded occurrence 926337; its `oldpbdb_occurrence_no` will have no occurrence row.

[‡] Counts measured 2026-11-17 on the Postgres-ported classic mirror.
