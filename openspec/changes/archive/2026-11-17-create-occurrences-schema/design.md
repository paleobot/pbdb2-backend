## Context

See proposal.md for motivation. Everything below was measured on 2026-11-17 against the Postgres-ported
classic mirror (`PG_CLASSIC_*`); counts can drift slightly from the MariaDB figures in
`migrations/mariadb/PBDBLegacy-DeepAnalysis/`, which are older.

**Two source tables carry one concept.** `occurrences` holds the original identification; each row of
`reidentifications` is a later identification of the same occurrence.

| | `occurrences` | `reidentifications` |
|---|---|---|
| Rows | 1,984,733 | 35,098 over 32,994 occurrences |
| Own authorizer / enterer | yes | **yes** (different from the occurrence's on 25% / 28% of rows) |
| Own reference | yes | **yes** (same as the occurrence's on only 407 of 35,083 rows) |
| Own collection | yes | yes (differs on 12 rows) |
| Own taxon | yes | yes (same taxon as the occurrence on 1,643 rows) |
| Plant organs | `plant_organ`, `plant_organ2` | `plant_organ` only |
| Abundance | `abund_value`, `abund_unit` | none |

A reidentification is therefore an independent identification act, with its own provenance, not an edit of
the occurrence. That is why it cannot be modelled with the version columns (D1).

**The occurrence row is the *original* identification, not the current one.** Joined to the reidentification
flagged `most_recent = 'YES'`, `occurrences.taxon_no` matches only 1,492 of 32,979 times. So the
occurrence row is the chain root and its reidentifications are its successors.

**Classic's own "current" bookkeeping is unreliable in two ways:**

- `occurrences.reid_no` is not a usable pointer. Of 23,925 occurrences with it set, 15 dangle and 1 points
  at a reidentification of a different occurrence; and 9,070 occurrences that *have* reidentifications leave
  it unset. It is not read.
- `reidentifications.most_recent` has exactly one `YES` per reidentified occurrence (clean), but in 555 of
  the 1,802 multi-reidentification chains the `YES` row is **not** the chronologically last one. In all 555
  it is strictly older by `created`. `reid_no` order and `created` order agree in all 1,802 chains.

**"Unset" is spelled two ways, unevenly** (same trap as specimens; see specimen-migration spec):

| Column | `IS NULL` | `= 0` |
|---|---|---|
| `occurrences.taxon_no` | 7 | 52,787 |
| `occurrences.collection_no` | 0 | 621 |
| `occurrences.reference_no` | 0 | 597 |
| `occurrences.authorizer_no` / `enterer_no` | 0 | 20 each |
| `reidentifications.taxon_no` | 0 | 452 |
| `reidentifications.collection_no` / `reference_no` | 0 | 0 |

**Orphans** (value set but target missing): occurrences: 10 rows with `taxon_no`, 5 with `collection_no`,
11 with `reference_no`; reidentifications: 1 with `reference_no`. All persons resolve. 15 reidentifications
point at an occurrence that does not exist.

**Occurrences with no parent collection.** 626 occurrences have no usable collection (621 zero plus 5
orphan). Inspecting them showed they are not live data that lost a link (D6): 594 are tombstones, 21 are
blank placeholders, 3 are test data, 2 are real rows whose collection was deleted, and 6 are real rows whose
collection was lost. The same rows account for every occurrence with no usable reference except 11 whose
`reference_no` is mis-keyed but whose collection has a valid reference.

## Goals / Non-Goals

**Goals:**
- A target table the migration can load every Classic occurrence into that has a parent collection, with the
  rest accounted for by name in an exclusions list.
- A payload schema whose `db` variant accepts everything Classic holds, including its quirks.
- A mapping document that hands the migration author the findings above.

**Non-Goals:**
- The migration script, runner step, audit registration, and any back-fill of
  `specimens.name_opinions_permid`.
- Deriving the current identification, `original_permid`, or `concept_permid` (read-time concerns; see
  §9.8.5 of `docs/classic-taxa-opinions.md`).
- `occ_matrix`, `occ_taxon`, `occ_ref` and the other derived caches.
- Recovering a taxon for the 52,794 occurrences with `taxon_no` unset (D3).

## Decisions

### D1 — A reidentification is a new `occurrences` row, linked by `reidentifies_id`

Each reidentification becomes its own row with its own `permid`, `taxon_permid`, `reference_id`, persons and
payload. `reidentifies_id bigint REFERENCES occurrences(id)` points at the **immediately preceding**
identification, so a chain is a linked list: occurrence ← reid₁ ← reid₂ ← …. The occurrence row has it NULL.

*Alternative considered:* the version columns (`preceded_by_id`/`succeeded_by_id`). Rejected: those mean
"edited record", and `place_in_lineage()` assumes one permid per lineage. A different scientist re-identifying
a specimen is a taxonomic act, not a typo correction, and conflating them would make every identification
history read as an edit history. The measured provenance (own reference and people on almost every
reidentification) confirms they are independent facts.

*Alternative considered:* a separate `reidentifications` table (Classic's shape). Rejected: it is the
duplication the stub's author intended to remove, and it forces every "occurrences of taxon X" query to
union two tables.

`reidentifies_id` is an ordinary FK to `occurrences(id)`, so `swing_fks_to_new_version()` keeps it pointing
at the current version of the prior identification when that prior row is edited. No special handling.

### D2 — The migration records the whole chain and picks no winner

Consistent with the migration/derive boundary: no `current` flag column. The chain head (the row nothing
else `reidentifies_id`-points to) is derived at read time. Chain order is `reid_no` ascending, which equals
`created` order in all 1,802 multi-reidentification chains. The 555 chains where Classic's `most_recent`
disagrees with that order are an anomaly to report, not to correct, and the head implied by the chain is
what 2.0 will show. The migration author should log them.

### D3 — `taxon_permid` is nullable and the verbatim names always live in the payload

52,794 occurrences (2.7%) have no taxon, and 7,531 of the 52,737 that carry names match an authority name
exactly. Recovering those is a judgment call and is out of scope. So `taxon_permid` is NULL for them and
the as-identified names stay in the payload for **every** row, resolved or not. The names are information
the permid alone does not carry: `cf.`, `aff.`, `?`, and subgenus.

`taxon_permid` stores a `name_opinions.permid` (a name as spelled, from `name_opinions.oldpbdb_taxon_no`),
per §9.8.5. It is deliberately not a FK: `permid` is not unique on a versioned table, and it follows the
opinion tables' convention. Resolution gaps: 2 distinct orphan `taxon_no` values (10 rows) in occurrences,
0 in reidentifications.

### D4 — What is a column and what is payload

| Column | Source |
|---|---|
| `permid`, `authorizer_person_id`, `enterer_person_id` | minted / resolved |
| `taxon_permid` | `taxon_no` via `name_opinions.oldpbdb_taxon_no` |
| `collection_id` | `collection_no` via collections `legacyIDs.oldpbdbID` |
| `reference_id` | `reference_no` via refs `legacyIDs.oldpbdbID` |
| `reidentifies_id` | chain link (D1) |
| `oldpbdb_occurrence_no`, `oldpbdb_reid_no` | join keys; the second is set only on reidentification rows |
| `created_at` | `created` |
| payload: `identification`, `abundance`, `plantOrgans`, `comments`, `legacyIDs` | the remaining content columns |

`created_at` keeps Classic's `created` (decided with the project owner; 66 occurrences have it NULL, 6,356
predate 1998). Not migrated, matching specimens and collections: `modified`, `updated`, `modifier_no`,
`updater_no`, the denormalized `authorizer`/`enterer`/`modifier` text, `upload`, `upload_id`, and
`reidentifications.modified_temp`.

The mirror shows 247,644 occurrences with `modified < created`, not the 1.05M the anomaly report cites; the
report probably counted differently. Either way `modified` is not carried, so it does not matter here.

### D5 — Payload shape: verbatim names with a resolution per rank

`identification` holds one object per rank, each `{ "resolution": …, "name": … }`, with absent keys
omitted. The resolutions are closed enums that mirror Classic's, kept inline because code (the reso
semantics) depends on them, not `x-enumFrom`:

- genus: `aff. cf. ex gr. n. gen. sensu lato sensu stricto ? " informal`
- subgenus: same, with `n. subgen.`
- species: same, with `n. sp.`
- subspecies: adds `var morph forma mut` and `n. ssp.`

Two values are kept verbatim rather than repaired: the ditto mark `"` (11,040 genus / 424 species rows), a
data-entry shorthand for "same as the row above" (the anomaly report confirms it is not an error), and
`sensu stricto`. Resolving a ditto would be a data repair; it is the next team's call whether to expand them.
NULL and `''` are both "no resolution" and are omitted (genus_reso: 11,326 NULL and 1,870,993 `''`).

`name` is not required: 50 occurrences have an empty `genus_name` and 2,301 an empty `species_name`.
`abundance` is `{ value, unit }`, both free text (`abund_unit` has about 15 values but is a `varchar(20)`
the legacy UI enforced loosely; promote to an enum only if a later pass wants it). `plantOrgans` is an array
built from `plant_organ` then `plant_organ2` (2,024 rows use the second), in closed-enum values that
Classic's `plant_organ_enum` defines. `comments` is free text.

### D6 — `collection_id` and `reference_id` stay NOT NULL; collection-less rows are not migrated

An occurrence has no meaning without its collection, so both columns keep the stub's `NOT NULL`. Specimens
made `collection_id` nullable because it is genuinely optional there; it is not here.

The 626 source occurrences with no resolvable collection were inspected and fall into five groups. None is a
live occurrence that merely lost a link:

| Category | Rows | What they are |
|---|---|---|
| `tombstone` | 594 | `collection_no = 0`, `reference_no = 0`, no taxon; genus is `Error` on 543; comment ` was collection_no N reference_no M`. Classic blanked these when it deleted a collection, leaving a note of the origin. None is in `occ_matrix`, none has a specimen. |
| `blank-placeholder` | 21 | `collection_no = 0`, empty genus name, no taxon; 20 also have blank enterer and `authorizer_no = enterer_no = 0`. Batches under references 3945 and 3992. |
| `test-data` | 3 | Orphan collections 9590 (`Crapphyllum shitvillensis` ×2) and 10463 (`Big cow`). |
| `collection-deleted` | 2 | Real taxa (*Douvilleiceras mammillatum*, *Hallex* sp.) whose collections 52944 and 3122352 no longer exist. |
| `collection-lost` | 6 | P. Wagner, reference 13541, 2005-05-17: four named taxa and two `indet.`. Reference 13541 has 12 collections, and occurrence 499207, created in the same batch, has one. |

The migration does not load them. It lists them in `docs/occurrences-excluded.csv` (generated from the
mirror; one row each, with category, the original collection and reference where Classic recorded them, and,
for `collection-lost`, the candidate collections). The six `collection-lost` rows are a curation list for a
human; no collection is guessed for them. The 15 reidentifications whose occurrence does not exist are
excluded and listed the same way (`orphan-reidentification`).

With those rows set aside, no remaining occurrence needs a person fallback (all 20 `authorizer_no = 0` rows
are blank placeholders), and `reference_id` stays NOT NULL with the specimens fallback: when an occurrence's
`reference_no` is unset or unresolvable, use its collection's. This applies to 11 rows whose `reference_no` is
a value that is not in `refs` (apparently mis-keyed collection references: 1313309 against the collection's
13309); all 11 have a collection with a valid reference.

One specimen (`specimen_no` 20612) references an excluded occurrence (926337, `collection-deleted`). Its
`collection_id` is already NULL in `specimens`; its `oldpbdb_occurrence_no` will have no occurrence row.

*Alternative considered:* nullable `collection_id` and `reference_id`, loading every row. Rejected: it would put
594 deletion tombstones and 21 blank rows into a table that readers expect to be meaningful occurrences, and
every consumer would then have to filter them out.

*Alternative considered:* guessing parents for the six `collection-lost` rows from the same-batch neighbour.
Rejected: it is an inference, not a recorded fact, and belongs in a human-reviewed fix.

### D7 — Versioning like every other entity table

`install_version_triggers('occurrences')`, uuidv7 `permid` with the same CHECK, and every migrated row starts
as a version-1 head. Each reidentification gets its own `permid` (it is a citeable identification act). The
head-only indexes mirror the opinion tables, because "current version of this row" is the hot lookup.

## Risks / Trade-offs

- [1.98M-row table, ~12× specimens] → head-only partial indexes are created in DDL; the follow-on change must
  batch inserts and keep the occurrence-number → id map out of per-row queries.
- [Chain pointer needs the prior row's id] → load occurrences in `occurrence_no` order and each chain in
  `reid_no` order, within one transaction per batch, or do a second pass to set `reidentifies_id`.
- [`reidentifies_id` is a swing FK] → the swing trigger scans for FK columns on every new version of any
  occurrence; with 2M rows it relies on an index on `reidentifies_id`, which the DDL provides.
- [Excluding rows loses 626 occurrences] → every one is listed in `docs/occurrences-excluded.csv` with a category; the 6 `collection-lost` rows are flagged for human curation.
- [Payload schema is lenient (`name` not required)] → matches the data; tighten for the create variant later.

## Migration Plan

This change is schema, mapping, and docs only. It ships by editing `02-core.sql`, which is applied to an empty
database by `--createdb`; no data migration and no rollback. The migration script, runner step 11, and audit
registration are a follow-on change, scoped in `tasks.md` under "Handed off".

## Handed off to the migration change

Findings the migration author needs, in addition to D1–D7:

1. **Do not read `occurrences.reid_no` or `reidentifications.most_recent`** to order or head a chain; use
   `reid_no` order. Log the 555 disagreements.
2. **Exclude the 626 collection-less occurrences and the 15 orphan reidentifications** (D6;
   `docs/occurrences-excluded.csv`). Recognize them by the same predicates, not by a hard-coded id list, and
   assert the exclusion count equals the CSV's. `0` and NULL are one condition on every FK column.
3. **Reference fallback** for `reference_no` unset or unresolvable: the collection's reference (11 rows). Fail
   the run if a remaining row has neither.
4. **`created_at`:** pass an explicit NULL for the 66 occurrences with no `created` rather than letting the
   column default stamp the migration time.
5. **Resolutions:** map `''` and NULL to "key omitted"; keep `"` verbatim.
6. **Specimens back-fill** (`specimens.name_opinions_permid` from the occurrence) stays out unless the
   project owner asks for it; see D1 of the specimens change.
7. **Row-count targets:** 1,984,733 − 626 = 1,984,107 occurrences, plus 35,098 − 15 = 35,083
   reidentifications, so 2,019,190 target rows.

## Open Questions

- Whether to expand ditto-mark resolutions (`"`) into the value they stand for. Deferrable: the enum already
  admits `"`, so expanding later needs no schema change.
