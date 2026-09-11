# PBDB2 API — Taxa Classification Reads: Measured Findings

**Status:** Design reference (measured, not yet implemented)
**Audience:** PBDB2 API contributors
**Subject:** How the `taxa` table differs from the uniform resources, and what
measurement says about reading its classification hierarchy

---

## 1. Why this document exists

Every resource the API reads today (`references`, `authorities`, `collections`,
`schemas`) is **hand-entered, JSONB-payloaded, and version-chained**. The `taxa`
table is none of those, and its classification hierarchy is deep enough that the
obvious read strategies have materially different costs.

This document records the **measurements** behind those decisions so the
`add-taxa-reads` change (and anything later that touches taxonomy reads) can cite
numbers instead of re-deriving them. Design decisions themselves live in that
change's `design.md`; what is here is the evidence.

> **The decisions are in `openspec/changes/add-taxa-reads/design.md`.** When this
> document was written that file did not yet exist, and the forward reference
> above dangled for a day — long enough for decisions made alongside these
> measurements to be lost and have to be recovered. It exists now, and it is the
> place to look for *why*: the path-over-CTE choice, the read-only 405 surface,
> why no depth cap, and why `removed` is not filtered (§9 below). Read it before
> re-deriving anything from the numbers here.

All figures were measured **2026-09-10** against the local development database
(`PG_DATABASE=pbdb`, the same one `pbdb2-migrations` loads). They are a snapshot
of a dev dataset, not a production guarantee — but the dataset is real migrated
PBDB data, and the structural findings (§4) are exact over all rows.

---

## 2. How `taxa` differs from the uniform resources

|            | `refs` / `authorities` / `collections` / `schemas` | `taxa`                                    |
| ---------- | ------------------------------------------------- | ----------------------------------------- |
| identity   | `permid` (uuid v7)                                 | `permid` (uuid v7) — same                 |
| payload    | JSONB column                                       | **none** — typed columns                  |
| lineage    | `preceded_by_id` / `succeeded_by_id` + triggers    | **none** — `UNIQUE (permid)`              |
| soft delete| `removed`, honored in `HEAD_FILTER`                | column exists, nothing sets it            |
| provenance | `authorizer_person_id` / `enterer_person_id`       | **none** (derived rows have no enterer)   |
| writes     | eventual CRUD                                      | **never** — `derive_taxa()` output        |

`taxa` is **Layer 3**: pure materialized output of `derive_taxa()`, upserted in
place by `rebuild_taxa()`. The write surface for taxonomy is the *opinion* tables
(`name_opinions`, `assignment_opinions`, `validity_opinions`), which are the
version-chained, person-attributed, hand-entered inputs.

Two consequences for the API:

- The generic read repository **cannot** serve `taxa`. `HEAD_FILTER` references
  `succeeded_by_id`, a column `taxa` does not have — that is a SQL `42703` on
  every request, not a graceful degradation.
- `taxa` is the API's first **read-only** resource. There is no `/versions`
  sub-resource in its future either: the current schema dropped taxa versioning
  in the `taxa-tables-rework` change, so point-in-time reconstruction means
  replaying opinions, not reading a taxon's history.

---

## 3. Shape of the data

```
rows ................................. 517,226
roots (containing_concept_permid NULL)   7,722
classification_path populated ........ 517,226 / 517,226   (100%)
```

```
depth   min    1
        p50   16   ████████████████
        p90   37   █████████████████████████████████████
        p99   44   ████████████████████████████████████████████
        max   70   ██████████████████████████████████████████████████████████████████████
        avg   19.08

deeper than 25 levels ....... 130,497   (25.2%)
deeper than 40 levels .......  19,634   ( 3.8%)
longest path string .........   2,589 chars
```

The depth-70 / 2589-char figures quoted in `create_new.sql`'s own comments are
current and reproducible, not historical worst cases. Depth is this large because
the reworked `taxa` merges Linnaean *and* clade opinions into one tree;
`taxa_linnaean` alone runs ~15–20.

Field population, which affects how much of the representation is usually null:

```
concept_permid <> permid (synonym / non-accepted spelling) ... 158,732   (30.7%)
nomenclatural_status_id NOT NULL ............................    8,496   ( 1.6%)
authority_id IS NULL ........................................        0
```

`accepted` is therefore load-bearing — nearly a third of rows point elsewhere —
while `nomenclaturalStatus` is null for 98.4% of rows. `authority_id` is never
null in this dataset, though the column is nullable and code should handle it.

### One concept, many rows

A concept is shared by every synonym and alternate spelling of it, so resolving
an ancestor by `concept_permid` alone is not enough:

```
distinct concept_permids ....................... 358,494
rows where permid = concept_permid ............. 358,494   (exactly one per concept)
concepts with no such row ...........................  0
concepts with more than one .........................  0
max rows sharing a single concept ................... 88
```

Exactly one row per concept satisfies `permid = concept_permid`, across all rows.
That predicate is what the ancestor fetch must pin: without it, one chain level
can fan out into all 88 rows carrying that concept.

### `removed` is dead on this table

```
rows with a non-null `removed` .......................  0
```

Not "none yet" — by construction. `rebuild_taxa()` names `removed` in neither its
`INSERT` column list nor its `ON CONFLICT DO UPDATE SET`, and rows its derivation
stops producing are **hard-deleted**:

```sql
-- create_new.sql, rebuild_taxa()
DELETE FROM taxa t
WHERE NOT EXISTS (SELECT 1 FROM _rebuild_taxa_src s WHERE s.permid = t.permid);
```

Soft deletion is honored one layer upstream instead: `derive_taxa()` reads the
opinion tables through `WHERE n.removed IS NOT TRUE AND n.succeeded_by_id IS NULL`,
so a taxon whose supporting opinions are all removed simply stops being produced.
By the time a row exists in `taxa` it has already passed that filter, which is why
the API applies no `removed` predicate of its own.

---

## 4. `classification_path` is exactly consistent with adjacency

The DDL calls adjacency (`containing_concept_permid`) PRIMARY and
`classification_path` "an explicitly derived materialization that can be reshaped
or dropped as a cache change (§9.7.4)." Before relying on the path, it was
checked against the pointers across **all 517,226 rows**:

```
last path element == own concept_permid ......... 517,226 / 517,226   (100%)
penultimate element == containing_concept_permid    509,504
rows at depth 1 (roots, no penultimate) .........     7,722
                                                   ─────────
                                                     517,226  ✓ exact
```

Zero disagreement. Reading ancestors from the path is safe **today**.

### Two traps

**Label encoding.** ltree labels cannot contain `-`, so path elements are permids
with hyphens replaced by underscores. Round-trip with
`replace(label, '_', '-')::uuid` — safe because UUIDs contain no underscores.

**The last element is a *concept* permid, not the row's permid.** The path is
built from concept permids and ends at the node's own concept. For the 30.7% of
rows where `concept_permid <> permid`, that final element is *not* the row you
asked for. Ancestors are elements `[0 .. n-2]`; element `n-1` is the node's own
concept.

### Mitigation for the §9.7.4 risk

Because the backend reserves the right to reshape or drop `classification_path`,
the path→permids decoding SHOULD be isolated behind a single function, so a
future reshape is a one-file change. Walking `containing_concept_permid`
recursively remains the documented fallback and is what the backend's own
guidance recommends.

---

## 5. Performance: the path shortcut is not the faster option

Both strategies were timed warm (three runs each) on the same database. Target
for the single read was a depth-70 taxon; the page was 100 taxa deeper than 30
levels, ordered by permid.

| strategy                                     | single read (depth 70) | 100-item page |
| -------------------------------------------- | ---------------------- | ------------- |
| `classification_path` + one `= ANY()` fetch   | 0.87 – 1.01 ms         | 4.1 – 7.7 ms  |
| recursive CTE on `containing_concept_permid`  | **0.44 – 0.48 ms**     | 6.4 – 7.4 ms  |

The recursive CTE is ~2× faster on a single read; the page case is a wash. Both
are fast enough that **performance does not decide this**. An early measurement
that appeared to favour the CTE by 70× was a cold-cache artifact (115 buffer
reads vs. a fully warm comparison) and should be disregarded.

The real arguments for using the path are that it is **already on the row you
fetched** — depth, breadcrumbs, and ancestor-of tests then cost zero extra
queries — and that deduplication falls out naturally. The argument against is the
§9.7.4 coupling in §4.

> Note: the dropped GiST index is irrelevant here. (Confirmed live: the only
> index over `classification_path` is `taxa_linnaean_path_idx` on
> `taxa_linnaean`; `taxa` has none, because 2589-char values overflow an index
> page.) Reading the column off a row already located by `permid` does
> not use it. It would matter only for ancestor/descendant *search*.

---

## 6. Ancestor duplication: why lists and single reads differ

For a 100-item page of deep taxa, with every item carrying its full chain:

```
ancestor entries serialized ....... 3,930
distinct ancestors among them .......  310
duplication factor ................. 12.7×
approx JSON for the chains alone ... ~457 kB   (per page, before the taxa themselves)
```

The same ~310 ancestors are re-serialized 12.7 times over; near the root every
item repeats the identical kingdom / phylum / class. That asymmetry — one object
versus a hundred — is the reason the chain is treated differently per endpoint:

| endpoint                   | chain                                              |
| -------------------------- | -------------------------------------------------- |
| `GET /taxa/{permid}`       | full, nested                                        |
| `GET /taxa` (list)         | omitted by default; opt in via `?include=containingTaxa` |

Depth-70 nesting is defensible for a single object: it mirrors the data, there is
exactly one of it, and reaching a given rank is a client-side loop. On a list it
is ~457 kB of mostly-duplicate text that most callers did not ask for.

If breadcrumbs-on-lists is ever actually needed, the duplication factor is the
argument for a pooled shape (chains as permid references plus one shared
`included` map) rather than for inlining them.

---

## 7. Target representation

Settled during exploration; camelCase throughout, matching every existing payload
(snake_case remains query-param-only).

```
{
  permid               // taxa.permid
  name                 // taxa.name
  rank                 // taxonomy_ranks[rank_id].taxonomy_rank
  nomenclaturalStatus  // nomenclatural_statuses[...].status — null = valid (98.4%)
  authority            { citation, permid, href }   // authorities[authority_id]
  accepted             { name, permid, href }       // taxa[concept_permid]
  containingTaxa       { rank, name, permid, href,
                         containingTaxa: { ... } }  // recursive, root-ward
}
```

This decomposes into four enrichment kinds, only two of which are new machinery:

- **plain columns** — `permid`, `name`
- **dictionary flatten** (new, trivial) — `rank`, `nomenclaturalStatus`: an
  integer FK into a small static dictionary, rendered as its text value
- **FK enrichment** — `authority` and `accepted`. Structurally identical to the
  existing reference enrichment; `authorities.authority->>'citation'` is the
  exact analogue of `refs.reference->>'title'` (`citation` is a required string
  in `authority.schema.js`). `accepted` is the cheaper case: `concept_permid` is
  already a permid, so no id→permid translation is needed.
- **ancestor walk** (new, the real work) — `containingTaxa`, per §4–§6.

---

## 8. Reproducing these figures

```sql
-- §3 shape
SELECT count(*), count(classification_path),
       count(*) FILTER (WHERE containing_concept_permid IS NULL) AS roots,
       max(nlevel(classification_path)), avg(nlevel(classification_path)),
       max(length(classification_path::text))
  FROM taxa;

-- §4 path/adjacency agreement
SELECT count(*) AS total,
       count(*) FILTER (WHERE subpath(classification_path, -1)::text
                              = replace(concept_permid::text,'-','_')) AS last_is_own_concept,
       count(*) FILTER (WHERE nlevel(classification_path) > 1
                          AND subpath(classification_path, -2, 1)::text
                              = replace(containing_concept_permid::text,'-','_')) AS penult_is_container,
       count(*) FILTER (WHERE nlevel(classification_path) = 1) AS roots
  FROM taxa;

-- §6 duplication for a page
WITH page AS (SELECT permid, classification_path AS p FROM taxa WHERE permid IN (...)),
     ent  AS (SELECT lbl FROM page, LATERAL unnest(string_to_array(p::text,'.')) AS u(lbl))
SELECT (SELECT sum(nlevel(p)) FROM page) AS entries,
       (SELECT count(DISTINCT lbl) FROM ent) AS distinct_ancestors;
```

Timings in §5 used `EXPLAIN (ANALYZE, COSTS OFF)`, discarding the first (cold)
run of each strategy.

---

## 9. Related

- `openspec/specs/reference-enrichment/` — the enrichment pattern `authority`
  and `accepted` generalize from
- `docs/api-response-envelope-comparison.md` — the `{ data, meta, links }`
  envelope these reads return
- `pbdb2-migrations/postgresql/create_new.sql` — the authoritative schema
  (`taxa` DDL, `derive_taxa()`); note `pbdb2-dev/new_tables/create_new.sql` is
  behind and still carries the pre-rework, *versioned* `taxa`
- `pbdb2-migrations` `openspec/changes/archive/taxa-tables-rework/` — why `taxa`
  is a combined Linnaean+clade derivation, and why it is no longer versioned
