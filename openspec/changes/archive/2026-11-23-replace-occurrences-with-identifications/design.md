## Context

See proposal.md for motivation. The source measurements are in the archived
`openspec/changes/archive/2026-11-17-create-occurrences-schema/design.md` and are not repeated; this change
keeps them and adds the ones below (measured 2026-11-23 on the Postgres-ported classic mirror).

The model borrows the shape of the taxonomy opinion system, so the parallel is worth stating once:

```
 taxonomy                                   occurrences
 ────────                                   ───────────
 name_opinions   (versioned, append-only)   identifications        (versioned, append-only)
   root row mints a name                      root row mints an occurrence
   subject_permid = permid on the root        occurrence_permid = permid on the root
   other rows point at the root               other rows point at the root
   identity (new_name, rank_id) on root       identity (collection_id) on root
        │ derive_taxa() / rebuild_taxa()           │ derive_occurrences() / rebuild_occurrences()
        ▼                                          ▼
   taxa  (plain cache, upsert by permid)      occurrences  (plain cache, upsert by permid)

                                              occurrence_abundances  (versioned, by occurrence_permid)
```

Facts that shape the design:

- **Reidentifications are independent statements.** Own authorizer, enterer, reference and taxon on nearly
  every row (archived design, Context). That is what makes them opinions rather than edits.
- **Plant organ is partly per-identification, abundance is not.** Of the 35,083 migratable reidentifications,
  206 carry a `plant_organ` and 265 differ from their occurrence's. Abundance (`abund_value`) is on 800,731
  of 1,984,112 occurrences with a collection (40%) and on no reidentification.
- **Collection is an identity of the occurrence, and Classic breaks that in 12 places.** 12 of the 35,083
  reidentifications name a different collection from their occurrence. Seven are one pair, 57958 and 122362,
  pointing at each other (occurrence 558371 is in 122362 with its reidentification in 57958; 558379 is the
  reverse), which looks like a bulk move or swap. The other five were created minutes after their occurrence,
  which looks like a slip within one entry session. The data does not say which side is right.
- **Nothing references `occurrences(id)` today.** The only foreign keys to it are its own
  `reidentifies_id`, `preceded_by_id` and `succeeded_by_id`. `specimens` carries `oldpbdb_occurrence_no`
  and `name_opinions_permid` but no FK. Replacing the table breaks no dependent.
- **Version rows do not inherit `created_at`.** `place_in_lineage()` sets `preceded_by_id` and clears
  `succeeded_by_id` but leaves `created_at` at its `DEFAULT NOW()`. Each version of a row therefore has its own
  timestamp (D4 depends on this).

## Goals / Non-Goals

**Goals:**
- A target in which every Classic identification act is one row, none is chosen as current by the migration,
  and the current identification is a derived, rebuildable fact.
- Several concurrent identifications of one occurrence are representable.
- `occurrences.permid` equals its root identification's permid, as `taxa.permid` equals its root opinion's.
- Abundance has its own table and can later gain provenance of its own.

**Non-Goals:**
- The migration script, runner step, and audit registration (a follow-on change).
- Resolving an identification to a current accepted taxon concept. `taxon_permid` stays a name permid; mapping
  it through synonymy is a read-time join to `taxa`, not a derive-time cache (D8).
- Ranking identifications by anything beyond reference year and entry time (D4), such as an `evidence` flag.
- Moving an occurrence between collections (D3).
- API routes for any of these tables.

## Decisions

### D1 — `identifications` is a versioned table shaped like `name_opinions`

Columns: `id` bigint identity, `permid` uuidv7 (same CHECK as the other versioned tables), the two person
columns, `occurrence_permid uuid NOT NULL`, `collection_id bigint REFERENCES collections`, `taxon_permid uuid`,
`reference_id bigint REFERENCES refs NOT NULL`, an `identification` jsonb payload, `oldpbdb_occurrence_no`,
`oldpbdb_reid_no`, and the standard `removed`, `created_at`, `preceded_by_id`, `succeeded_by_id`, with
`install_version_triggers('identifications')`.

Root-ness is inferred, not stored: a row is the root when `occurrence_permid = permid`. A shape CHECK ties
collection to root-ness, the same device `name_opinion_shape` uses for `new_name`/`rank_id`:

```
CHECK ((occurrence_permid = permid) = (collection_id IS NOT NULL))
```

Dropped from the `name_opinions` pattern, because an identification has no analogue: `target_permid`,
`edge_class`, `reason_id`, `negates`, `objective`, `authority_id`, `new_name`, `rank_id`, `evidence`,
`publication_year`, `attribution`.

*Alternative considered:* an explicit `is_root boolean`. Rejected: it can disagree with `occurrence_permid =
permid`, and the inferred form needs no extra column to keep consistent. A plain index on `occurrence_permid`
(all versions, not head-only) serves the derive lookup, because the lineage tie-break reads every version.

*Alternative considered:* a separate primary `occurrences` table holding collection, with identifications as
its children. Simpler, but it makes `occurrences` primary data rather than derived, which is what this change
sets out to avoid.

### D2 — An occurrence's permid is its root identification's permid; ids stay stable by upsert

`occurrences.permid` is `identifications.permid` of the root. Non-root identifications point back with
`occurrence_permid`, as non-root opinions point back with `subject_permid`. No FK is declared on
`occurrence_permid`, since `permid` is not unique on a versioned table (many versions share it); the
opinion tables follow the same convention.

`occurrences.id` is stable because `rebuild_occurrences()` upserts keyed on `permid` and never rewrites
the key, exactly as `rebuild_taxa()` does. Other tables should reference an occurrence by permid, not by
`occurrences.id`.

### D3 — `collection_id` lives only on the root; an occurrence does not move

An occurrence belongs to one collection for life, so the collection is part of its minted identity. Only the
root carries it (D1 CHECK). For migration: each Classic occurrence's `collection_no` becomes the root's
`collection_id`; a reidentification's `collection_no` is ignored.

The 12 disagreeing reidentifications are logged for curators with both collections, not resolved: the data
shows a swap and a likely slip but not which side is correct. This is the one place where Classic carried
more information than the new model keeps, so it is recorded in the mapping document rather than lost.

If the project ever wants to correct a collection, the root is versioned like any row, which preserves the
permid and re-derives the occurrence. That needs no new mechanism.

### D4 — The winner is the identification with the latest reference; entry time breaks ties

`derive_occurrences()` chooses, per `occurrence_permid`, among rows that are heads (`succeeded_by_id IS NULL`)
and not `removed`, the one ranked first by:

```
1. publication year of the identification's reference, latest first, NULLs last
   (refs.reference->>'publicationYear', the same expression derive_taxa() uses)
2. the lineage's first-entry time, latest first:  min(created_at) OVER (PARTITION BY permid)
3. the lineage's first id, highest first:          min(id)         OVER (PARTITION BY permid)
```

This is the opinion rule (the latest published statement wins), minus `evidence`, which an identification does
not carry. A later paper's determination supersedes an earlier paper's whatever order they were typed in, and
this matters here because entry order is a poor proxy for publication order: someone can enter a 1954
re-examination today.

Steps 2 and 3 use the lineage, not the head row. Every version row gets `created_at = NOW()`, so ordering a
tie by the head row's timestamp would let the correction of a typo in an old identification make it the
"newest" and unseat a later one. "Entered" is a property of the lineage.

Measured on the mirror, over the 32,979 occurrences that have reidentifications (each occurrence's own row is
the root and competes with its reidentifications), with each row's reference mapped to its publication year:

| | occurrences |
|---|---|
| Winner differs from "latest entered" | 1,360 (4.1%) |
| ...of which the original (root) identification wins on year | 770 |
| Top year is shared, so entry time decides | 1,104 (3.3%) |

So the two rules agree on 96% of occurrences, and the reference rule hands the winner to the original
identification in 770 cases where a reidentification cites an older paper than the original does. Those are
the cases the rule exists for. The year is read from the reference's current head at derive time, so
correcting a reference's year can change winners: `rebuild_occurrences()` is part of the same rebuild pass as
`rebuild_taxa()` for that reason (see Risks).

This ignores Classic's `most_recent` flag, which is wrong against its own chronology in 555 of 1,802
multi-reidentification chains (archived design, Context), and ignores `reid_no`, which is only an order.

*Alternative considered:* newest entered only, as I first proposed. Rejected: entry order is not publication
order, and it would make the winner depend on when a paper happened to be keyed in.

*Risk:* a reference with no `publicationYear` ranks last, so an identification citing it loses to any dated
one. `created` is NULL on 66 occurrences; as roots they sort last on the tie-break, which is right if they are
alone and acceptable otherwise. The migration passes an explicit NULL rather than letting the default stamp
the migration time (handed-off item 4 of the archived design), and derive orders `NULLS LAST` in both places.

### D5 — A removed root removes the occurrence

The root is the minting row. If the head of the root's lineage is `removed`, `derive_occurrences()` produces no
row for that occurrence, and `rebuild_occurrences()` deletes the cached one. Removing a non-root identification
just drops it from the candidates; the next-newest wins. If every non-root is removed the root wins.

The reason is that "the original identification was wrong" is corrected with a newer identification, not a
removal; removing the root says the occurrence never existed.

### D6 — The derived `occurrences` row

A plain, unversioned cache like `taxa`: `id` identity, `permid` UNIQUE, `collection_id`, `reference_id` (the
root's), `taxon_permid` (the winner's), `identification jsonb` (a copy of the winner's `identification` payload
block, so the name and its qualifiers can be read without a join), `plant_organs text[]` (D8),
`winning_identification_id`, `oldpbdb_occurrence_no`, `removed`, `created_at` (the root lineage's first-entry time). Head-only indexes become plain indexes (the cache has no
history): `taxon_permid`, `collection_id`, and `oldpbdb_occurrence_no` via the root.

The name is denormalized into the cache, so the upsert guard compares `identification` and `plant_organs` with
`IS DISTINCT FROM` like every other column. A future API parameter (such as `response=long`) can join to the
full identification when more than the name is wanted; nothing here depends on that.

`rebuild_occurrences()` follows `rebuild_taxa()`: materialize `derive_occurrences(NULL)` once, upsert with a
`DO UPDATE ... WHERE ... IS DISTINCT FROM` guard so unchanged rows are not touched, then **delete rows whose
permid is no longer produced**. The deletion path is explicit because the earlier `rebuild_*` functions once
shipped upsert-only and left orphans (fixed in 9b2662c).

`derive_occurrences(seed uuid[])` accepts a permid array. Unlike `derive_taxa()`, whose seed only filters
final output, an identification group is independent of every other, so a seed can restrict the work itself.
Timed on a synthetic load of the full target size (1,984,107 roots and 35,083 further identifications, 2,000 references,
Postgres 17 on a laptop; the load itself took 90 s with the version triggers on):

| Operation | Time |
|---|---|
| `derive_occurrences()` over everything | 14.6 s |
| `rebuild_occurrences()`, first run (2M rows written) | 82 s |
| `rebuild_occurrences()`, nothing changed | 25 s |
| `derive_occurrences(seed)` of 1,000 permids, seed passed as a parameter or array literal | 5-60 ms |
| the same 1,000 with the seed passed as a scalar subquery expression | 4.4 s |

So the seed does limit the work, provided it reaches the function as a parameter or literal. A subquery expression is planned
as a subplan and loses the index; callers pass the array, not a subquery. A seed read from a temporary table inside a
parallel plan fails with "cannot access temporary tables during a parallel operation", so a caller with a temp-table seed must
select it into an array first.

### D7 — `occurrence_abundances` is its own versioned table

Keyed by `occurrence_permid`; own `permid`, person columns, `reference_id`, and an `abundance` jsonb payload
(`value`, `unit`), standard version columns and triggers. At most one head per `occurrence_permid`
(a unique index on version-1 rows, because a unique index on heads would reject a new version while the old head
still stands). The migration creates one row per Classic occurrence whose `abund_value` or `abund_unit` is non-empty (800,729 with a value plus 1,171 with only a unit),
copying the occurrence's authorizer, enterer, reference and `created` because Classic recorded no separate
authorship. 801,900 rows.

It is not folded into the derived `occurrences` row: that would duplicate 800K rows of a primary fact into a
cache. Reads join on `occurrence_permid`.

*Alternative considered:* abundance in the root identification's payload. Rejected for this change by the
project owner: it conflates a count about the occurrence with the identity row, and gives it no provenance
of its own.

*Alternative considered:* `specimens` or `collections`. Rejected: `specimens` is a physical-specimen record
with its own collection and taxon, and abundance is a count about the occurrence, not about one specimen.

### D8 — Plant organs stay on the identification; `taxon_permid` stays a name permid

`plantOrgans` is in the identification payload on every row, as Classic has it. The derived `plant_organs` is
the organs of the highest-ranked identification (by the D4 order) that has any; a winner with none inherits
from the next-ranked identification that does. Organs are a property of the specimen, not of the name, so a
reidentification that is silent about them should not erase them. Classic differs on 265 reidentifications
(organs differ from the occurrence's), and where both have organs the winner's are used.

`taxon_permid` carries over the archived D3 unchanged: a `name_opinions` permid via `oldpbdb_taxon_no`,
nullable, not a FK to `taxa`, with the verbatim names always in the payload. The derived row copies the
winner's. Resolving it onward to an accepted concept is a join to `taxa` at read time, kept out of the derive
step so that a change in taxonomy never forces occurrences to be rebuilt.

### D9 — Payload schemas

`payloadSchemas/identification.schema.js`: `permid`, `legacyIDs` (`oldpbdbID`, `oldpbdbReidID`),
`identification` (genus, subgenus, species, subspecies, each `{resolution, name}`, with the closed resolution
enums and the ditto mark kept verbatim as in the archived D5), `plantOrgans`, `comments`.
`payloadSchemas/occurrenceAbundance.schema.js`: `value`, `unit`, both free text (`abund_unit` has about 15
values; promote to an enum only if a later pass wants it).
Both are draft 2020-12 with `unevaluatedProperties: false`, derived into the four variants like the others.

### D10 — What this supersedes

From the archived `create-occurrences-schema`: **D1** (reidentification as a `reidentifies_id` row) and **D2**
(head derived at read time via the chain) are replaced by D1 and D4 here; **D4**'s column table is replaced by
D1, D6 and D7; **D7** (versioning `occurrences`) moves to `identifications`. **D3**, **D5**, **D6** and the
"Handed off" items 1, 2, 4, 5 and 6 stand as written, restated against the new tables in the mapping
document. Row targets change shape but not count: 1,984,107 root identifications + 35,083 non-root =
2,019,190 `identifications` rows, plus 801,900 `occurrence_abundances` rows, and 1,984,107 derived
`occurrences`.

## Risks / Trade-offs

- [98% of occurrences have exactly one identification, so most of the added machinery serves about 2% of
  rows] → accepted for a single versioned, auditable model and no dependence on Classic's flags; the derive is a
  per-group `DISTINCT ON`, not a graph, so its cost is small.
- [Derive over 2M rows is a new full-table pass after every bulk load] → measure it; `derive_occurrences(seed)`
  supports a restricted rebuild, and the upsert guard avoids rewriting unchanged rows.
- [Latest-reference can promote an identification whose reference is dated wrongly, or unseat one citing an
  undated reference] → deliberate (D4); concurrent identifications stay queryable in `identifications`, only the
  cache picks one.
- [The winner now depends on `refs`, so editing a reference's year can change winners] → `rebuild_occurrences()`
  must run after reference changes; a spec scenario covers it. It is a separate entry point, not part of
  `rebuild_taxa_full()`, whose return shape other specs fix and which does not read reference years.
- [`occurrences.id` is a cache key] → other tables reference the permid (D2); `specimens` already uses
  `oldpbdb_occurrence_no` and `name_opinions_permid`, not an id.
- [A new version row carries a new `created_at`] → D4 orders by the lineage's first row, and the spec requires
  a scenario that proves a corrected root does not change the winner.
- [12 reidentification collections are discarded] → logged with both values for curators (D3).
- [Replacing a merged schema] → no dependents exist, so it is a DDL edit; the archived change is left intact as
  the audit trail.

## Migration Plan

Edit `db/02-core.sql` (and the file holding the cache) to replace the `occurrences` stub with `identifications`,
`occurrence_abundances` and the cache; applied to an empty database by `--createdb`, so no data migration
and no rollback. The follow-on migration script loads `identifications` (roots first, then non-roots, each
chain in `reid_no` order for readability only: order no longer affects correctness), then
`occurrence_abundances`, then calls `rebuild_occurrences()` once.

## Open Questions

Settled with the project owner (2026-11-23): one abundance head per occurrence (D7); plant organs inherit from
the next-ranked identification that has them (D8); the derived row carries the winning name (D6); the 12
mismatched collections go on a curator list (D3, `docs/occurrences-collection-conflicts.csv`); the winner is
ranked by latest reference (D4).

- **Same-year ties.** 1,104 occurrences share the top publication year, so entry time decides them (D4). If a
  curator would rather see the root or a specific reference type win, that is a later tweak to the ORDER BY.
- **Ditto marks.** Unchanged from the archived design: expand `"` later, no schema change needed.
