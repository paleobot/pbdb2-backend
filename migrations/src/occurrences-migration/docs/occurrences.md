# Classic occurrences + reidentifications → 2.0 `identifications`, `occurrence_abundances` [‡]

Every row of classic `occurrences` (1,984,733) and `reidentifications` (35,098) becomes one `identifications` row,
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
| `authorizer_person_id`, `enterer_person_id` | `authorizer_no`, `enterer_no` | resolves to `persons.id` = `person_no`. The 20 rows holding `0` are all excluded blank placeholders, so no fallback is needed |
| `collection_id` | `collection_no` | via collections `legacyIDs.oldpbdbID`. **NOT NULL** on the root. The 626 occurrences with no resolvable collection (621 zero + 5 orphan) are not migrated: see "Excluded rows" |
| `taxon_permid` | `taxon_no` | the `TXN` permid of the root name opinion. Its number is the Classic `taxon_no`, so this is `TXN-<taxon_no>-<CC>` (format with `format_permid('TXN', …)`), but only after checking the root name opinion exists (`name_opinions.oldpbdb_taxon_no`). `0` and NULL are both unset (52,787 + 7, less the excluded rows) → NULL. 10 rows (2 distinct values) are orphans → NULL, logged |
| `reference_id` | `reference_no` | via refs `legacyIDs.oldpbdbID`. **NOT NULL.** When unset or not in `refs` (11 rows), use the collection's reference |
| `oldpbdb_occurrence_no` | `occurrence_no` | |
| `oldpbdb_reid_no` | — | NULL |
| `created_at` | `created` | 66 rows are NULL: pass an explicit NULL, do not let the default stamp the migration time |
| `identification.legacyIDs.oldpbdbID` | `occurrence_no` | |
| `identification.identification.<rank>.resolution` | `genus_reso`, `subgenus_reso`, `species_reso`, `subspecies_reso` | NULL and `''` → key omitted. Keep `"` verbatim |
| `identification.identification.<rank>.name` | `genus_name`, `subgenus_name`, `species_name`, `subspecies_name` | NULL and `''` → key omitted |
| `identification.plantOrgans` | `plant_organ`, `plant_organ2` | in that order; `''`/NULL dropped; omit the key if empty |
| `identification.comments` | `comments` | NULL and `''` → omitted |

## Abundances (from `occurrences`)

One `occurrence_abundances` row for each migrated occurrence whose `abund_value` or `abund_unit` is non-empty:
800,729 with a value plus 1,171 with a unit and no value = **801,900**. A unit with no value carries little, but it
is data, so it is kept rather than dropped.

| 2.0 column / payload field | Source | Notes |
| --- | --- | --- |
| `permid` | minted | `mint_permids('ABD', …)`, numbered from 10,000,000: Classic has no abundance number |
| `occurrence_permid` | the root identification's `permid` | an `OCC` permid; an FK to the registry |
| `authorizer_person_id`, `enterer_person_id`, `reference_id` | the occurrence's, as resolved for the root | Classic recorded no separate authorship, so the abundance copies the occurrence's. The reference includes the collection fallback |
| `created_at` | the occurrence's `created` | explicit NULL where NULL |
| `abundance.legacyIDs.oldpbdbID` | `occurrence_no` | |
| `abundance.value`, `abundance.unit` | `abund_value`, `abund_unit` | NULL and `''` → key omitted. Both stay text (`value` is not always a number) |

At most one abundance lineage may exist per occurrence; the table enforces it.

## Non-root identifications (from `reidentifications`)

| 2.0 column / payload field | Classic source | Notes |
| --- | --- | --- |
| `permid` | — | minted: `mint_permids('OCC', …)`, numbered from 10,000,000. `reid_no` overlaps `occurrence_no`, so it is not the number |
| `occurrence_permid` | the root's `permid` | found through `occurrence_no`. The 15 reidentifications whose occurrence does not exist (or is excluded) are not migrated |
| `collection_id` | — | **NULL.** Only the root carries the collection. The reidentification's own `collection_no` is ignored; see "Collection conflicts" |
| `taxon_permid` | the reidentification's own `taxon_no` | as for roots; 452 zeros → NULL |
| `reference_id` | the reidentification's own `reference_no` | 1 orphan → the root's `reference_id` |
| persons | the reidentification's own `authorizer_no`, `enterer_no` | not inherited from the occurrence |
| `oldpbdb_occurrence_no` | `occurrence_no` | the same value as the root's |
| `oldpbdb_reid_no` | `reid_no` | |
| `created_at` | `created` | |
| `identification.legacyIDs.oldpbdbID`, `.oldpbdbReidID` | `occurrence_no`, `reid_no` | |
| `identification.identification`, `.comments` | as for roots | |
| `identification.plantOrgans` | `plant_organ` | no second organ column |

There is nothing for abundance here: `reidentifications` has no abundance columns.

## What the derived `occurrences` row is

`rebuild_occurrences()` produces one row per root whose head is not removed (expect **1,984,107** after this load),
with the root's `collection_id`, `reference_id` and `oldpbdb_occurrence_no`, and:

- the **winning identification**: the one citing the reference with the latest `publicationYear`, undated references
  last; ties go to the lineage entered most recently (`created_at`, NULL last), then the highest lineage id;
- that identification's `taxon_permid` and name block (`identification`);
- `plant_organs` from the highest-ranked identification that has any, so a reidentification silent about the organs
  does not erase them.

Over Classic's data the winner differs from "most recently entered" on 1,360 of the 32,979 occurrences that have
reidentifications (770 of them go to the original identification), and 1,104 share a top year so entry time decides.

## Rules the migration must follow

1. **Never choose a current identification.** There is no flag and no filter. Load every row as an identification; the
   winner is derived.
2. **Do not read `occurrences.reid_no` or `reidentifications.most_recent`.** `reid_no` is NULL on 9,070 occurrences
   that have reidentifications and dangles or mismatches on 16 more; in 555 of 1,802 multi-reidentification chains
   the `most_recent = 'YES'` row is not the chronologically last one. Neither is needed: nothing orders or heads a
   chain at load time any more, and rows can be inserted in any order.
3. **`0` and NULL are one condition** on every foreign-key column.
4. **Exclude, do not load, the rows in `docs/occurrences-excluded.csv`** (see below), and assert the count.
5. **Reference fallback.** For a root whose `reference_no` is unset or unresolvable, use its collection's reference
   (11 rows); for a reidentification whose reference is unresolvable, use the root's (1 row). Fail the run if a
   remaining row has no reference.
6. **`created_at`:** pass an explicit NULL where Classic has none (66 occurrences) instead of letting the column
   default stamp the migration time. The tie-break reads it.
7. **Resolutions:** map `''` and NULL to "key omitted"; keep `"` verbatim.
8. **Log the 12 collection conflicts** (below) and the 10 unresolvable `taxon_no` rows.
9. **After the load, call `rebuild_occurrences()` once**, then assert the `occurrences` count equals the number of
   root identifications loaded.
10. **Do not backfill `specimens.name_opinions_permid`** from occurrences unless asked.

## Targets

| Table | Rows |
| --- | --- |
| `identifications` | 1,984,733 − 626 = **1,984,107** roots + 35,098 − 15 = **35,083** non-roots = **2,019,190** |
| `occurrence_abundances` | **801,900** |
| `occurrences` (derived) | **1,984,107** |

## Collection conflicts

Conceptually an occurrence never changes collection, and only the root carries one. In Classic, 12 of the 35,083
reidentifications name a different `collection_no` from their occurrence. They are listed, with both collections,
both references, both names and both enterers, in `docs/occurrences-collection-conflicts.csv`.

Seven belong to one pair, collections 57958 and 122362, which point at each other (occurrence 558371 is in 122362 and
its reidentification in 57958; 558379 is the reverse), which looks like a bulk move or swap. The other five were entered
minutes after their occurrence, which looks like a slip within one session. Nothing in the data says which side is
right, so the migration uses the occurrence's collection and leaves the 12 for a curator.

## Excluded rows

An occurrence has no meaning outside its collection (`collection_id` is NOT NULL on the root), so 626 source occurrences
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

[‡] Source counts measured 2026-11-17 and 2026-11-23 on the Postgres-ported classic mirror; the abundance counts and the
conflict list on 2026-11-23.
