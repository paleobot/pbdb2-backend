## Context

The occurrences migration (`create-occurrences-migration`, archived 2026-11-25) loaded three tables.
Their roles are described in `migrations/src/occurrences-migration/docs/occurrences.md`:

```
 identifications        ledger, version-chained, JSONB `identification`   2,046,335
   root rows            permid = occurrence_permid, collection_id set     2,010,858
   reidentifications    occurrence_permid → the root                         35,477
 occurrence_abundances  version-chained, JSONB `abundance`, ≤1 per occurrence  808,849
 occurrences            derived cache (rebuild_occurrences()), one row per live root  2,010,858
```

The cache mixes facts from three sources:

| Columns | Come from |
|---|---|
| `permid`, `collection_id`, `reference_id`, `oldpbdb_occurrence_no`, `created_at` | the root |
| `taxon_permid`, `identification` (the name block), `winning_identification_id` | the winner |
| `plant_organs` | the highest-ranked identification that names any organ |

Like `taxa`, it has no version chain, no write path, and a `removed` column that nothing writes.

The API already has the parts this change needs, though not in one place:

- **`taxa-repository.js`:** a bespoke reader for a derived table. It duck-types `readHead`/`readHeads`,
  pages by `permid_no`, and resolves descriptor links with `linkProjections()`.
- **`repository.js` + `merge()`:** reads version-chained JSONB resources through their payload source.
  The codec context resolves `x-storage` links.
- **Descriptor field filters:** they match JSONB payload fields only.
- **`csv.js`:** derives CSV columns from a source's `out` variant. `taxon.schema.js` is the precedent
  for a read-only source that describes a derived table.

These decisions were settled while exploring, on 2026-11-25. The measurements below are from localhost
`pbdb` (PG 16) with a warm cache unless noted.

## Goals / Non-Goals

**Goals:**

- `GET /occurrences` and `GET /occurrences/{permid}`, read-only, from the cache.
- `GET /occurrences/{permid}/identifications` and `GET /occurrences/{permid}/identifications/{permid}`,
  read-only, from the ledger.
- An occurrence representation that keeps the occurrence's provenance (the root's reference) apart from
  the naming provenance (the winner's reference).
- `collection`, `taxon` (exact) and `withinTaxon` (subtree) filters.
- CSV on the occurrence list and `ids` reads.

**Non-Goals:**

- Writes of any kind. The new codec's `split` exists only so the payload audit's round trip holds.
- Top-level `/identifications` or `/abundances`.
- Name, reference, interval and geography filters.
- Person links.
- Any change to `db/`: the cache, `derive_occurrences()` and the winner rule stay as they are.
- A generic derived-table repository.

## Decisions

### D1. Route shape: read-only occurrences, identifications nested under them

`routes/api/v1/occurrences/index.js` registers the group through `registerCrudRoutes({ readOnly: true })`
and adds two nested GET routes in the same plugin:

```
GET /occurrences                                   list (cache)
GET /occurrences/{permid}                          single (cache)
GET /occurrences/{permid}/identifications          list (ledger heads of that occurrence)
GET /occurrences/{permid}/identifications/{id}     single (ledger head)
POST/PUT/PATCH/DELETE on /occurrences[/{permid}]   405
```

**Why nested:**
- Every identification permid is an `OCC` permid, and a root identification's permid is also its
  occurrence's. A top-level `/identifications` would therefore answer two resources for one permid, the
  `TXN` overlap the backlog already records.
- An identification has no meaning outside its occurrence.
- The future write path gets obvious homes: POST `/occurrences` for a new occurrence, POST
  `…/identifications` for a reidentification.

**Alternatives:**
- (A) Embedding identifications only, with no nested route: the embedded winner's `href` would have
  nothing to point at, and `comments` and the winner's own `plantOrgans` would have no home.
- (C) Three top-level resources: rejected for the permid overlap above.

**Nested-route rules:**
- The nested routes answer 404 when the occurrence does not exist.
- The nested single read also answers 404 when the identification belongs to a different occurrence.
- They have no write verbs at all (not 405s), because they are not a route group of their own.

### D2. A bespoke occurrence repository; no generalization yet

`lib/occurrence-repository.js` duck-types `readHead`/`readHeads`, as `taxa-repository.js` does, so
`crud-routes.js` and `listReadHandler` drive it unchanged (`ids`, pagination, CSV export). It reads one
SQL statement per page:

```sql
SELECT o.permid, o.identification, o.plant_organs, o.oldpbdb_occurrence_no,
       w.permid AS winner_permid,
       it.name  AS taxon_name,                  -- NULL when taxon_permid has no taxa row
       a.abundance,
       <linkProjections: collection (o), reference (o), identification.reference (w), acceptedTaxon (it)>
FROM occurrences o
JOIN identifications w      ON w.id = o.winning_identification_id
LEFT JOIN taxa it           ON it.permid = o.taxon_permid
LEFT JOIN occurrence_abundances a
       ON a.occurrence_permid = o.permid AND a.succeeded_by_id IS NULL AND a.removed IS NOT TRUE
WHERE … ORDER BY o.permid_no LIMIT n+1
```

Measured with every join:

| Read | Time |
|---|---|
| Page of 100 | 5 ms |
| Page of 1,000 | 32 ms |
| Largest collection (1,227 occurrences) | 21 ms |

The abundance lookup is an index-only scan on `occurrence_abundances_one_head_per_occurrence`.

As with taxa, there is no stub: with no database the group answers 503. A stub list of 2 million
fossils would be a fiction.

**Why not generalize `taxa-repository.js`:** the two share about 15 lines (the `permid_no` keyset loop).
Everything else differs:
- Taxa has dictionary joins and the containing chain.
- Occurrences have the winner and abundance joins, the identification block and the link filters.

A shared "derived-table repository" would be a framework with two unlike callers. If a third derived
resource arrives, extract the keyset loop then.

### D3. Links reuse `linkProjections()` through joined rows; `collections` becomes a link target

`linkProjections(links, qualifier)` already takes the alias it correlates to. The occurrence's links are
single-valued columns on the occurrence row or on a row joined one-to-one with it:

| Field | Via | On | Target |
|---|---|---|---|
| `collection` | `o.collection_id` | id | `collections` (new target; label `name` in the `collection` JSONB) |
| `reference` | `o.reference_id` | id | `references` |
| `identification.reference` | `w.reference_id` | id | `references` |
| `acceptedTaxon` | `it.concept_permid` | permid | `taxa` |
| `identification.taxon` | `o.taxon_permid` + `it.name` | — | `taxa` (see D4) |

So no new link mechanism is needed. The `reference-enrichment` descriptor-link requirement is widened
from "a column on the resource's own table" to "a column on the resource's row or on a row its
repository joins one-to-one". The swing trigger keeps every id-keyed FK on the current head, so plain
joins resolve heads, as they do today.

**`href` hydration:** the top-level links hydrate through `hydrateLinkHrefs`. The two links inside
`identification` and the embedded identification's own `href` hydrate in the route's `hydrate`, the way
taxa hydrates its chain.

### D4. A taxon permid with no `taxa` row is `{ permid }`, with no name and no `href`

30 distinct `taxon_permid` values, on 547 occurrences, name a root name opinion that exists but has no
`taxa` row (the taxa orphans). For these:

- **`identification.taxon`** is `{ permid }`: no `name`, because there is no taxon to read one from; and
  no `href`, because `/taxa/{permid}` would answer 404. The `link()` schema already requires only
  `permid`.
- **`acceptedTaxon`** is `null`: without a taxon there is no accepted concept.
- **`taxon=`** (exact) still matches these occurrences. **`withinTaxon=`** never does.

**Alternatives:**
- `null`: loses the fact that the identifier's name resolved to a name opinion.
- A full link: its `href` would claim a taxon that does not exist.

`href` hydration therefore skips a link object with no label. This applies only to these taxon links;
every other target's row exists whenever its FK is set.

### D5. The embedded identification: the winner, with its ranks lifted

```
identification: {
  permid,                 w.permid
  href,                   <occurrence href>/identifications/<w.permid>
  name,                   formatted (D7)
  genus, subgenus, species, subspecies,     o.identification, keys lifted to this level
  taxon,                  D4
  reference               the winner's (w.reference_id)
}
```

The full record at the nested route keeps the stored shape, with the ranks under `identification`. So
the embedded object has the same fields with the ranks lifted, not a strict subset. This was chosen
2026-11-25 over two alternatives:
- Flattening the stored payload: a change to the schema, `derive_occurrences()` and the migration.
- Nesting in both places: `occurrence.identification.identification.genus`.

It omits `plantOrgans`, `comments` and `legacyIDs`:
- The occurrence-level `plantOrgans` is not the winner's alone, so showing the winner's own beside it
  would look like a contradiction.
- `comments` and `legacyIDs` belong to the full record.

The two references stay apart on purpose. `reference` (top level) is the root's: where the occurrence
was recorded, as the cache stores it. `identification.reference` is the winner's. They differ on 32,208
occurrences. Showing only one would misstate either the occurrence's provenance or its name's. The
winner's reference is read through the join, not cached: no measurable cost on a page, +0.6 s on a
2-million-row read.

### D6. The nested identifications read through `merge()` with `identificationSource`

Identifications are version-chained JSONB, so they read the way every such resource does: through their
payload source, with the codec context resolving links. `payloadSchemas/identification.schema.js` gains
two link properties, which are not stored in the JSONB:

- **`reference`:** `x-storage { column: "reference_id", codec: "referencePermid" }`, the existing codec.
- **`taxon`:** `x-storage { column: "taxon_permid", codec: "taxonPermid" }`, a new codec.
  - Its source is `taxa` (key `permid`, label `name`).
  - Its `merge` emits `{ permid }` alone when `taxa` has no row (D4), rather than throwing as `lookup()`
    does.
  - `loadCodecContext` gains a plain-column label (the label read from a column, not from a JSONB key),
    mirroring `LINK_TARGETS`' `labelColumn`.
  - Its `split` writes the permid to the column unchanged. The column holds the permid itself, so no
    lookup is needed, and the column's FK to the registry and its `TXN` check refuse a bad value.
    Requiring a root `name_opinions` row (`taxon_permid` is a name opinion's permid, not an FK to
    `taxa`) is the write path's business.

The migration validates against the `db` variant, which leaves out `x-storage` properties, so it does
not change. The payload audit's `--round-trip` does change: it merges each head identification and
splits it back, so its identification entry must select `taxon_permid` and `reference_id`, and the
round trip has to stay at zero differences (`payload-audit`, "Stable round trip"). That is the one
edit under `migrations/`.

The nested reader is a small function in `occurrence-repository.js`:
- It selects the heads with `occurrence_permid = $1`, not removed, loads the codec context for that
  page, and merges each row.
- It adds the API-composed `name` (D7), the way taxa adds `containingTaxa`.

**Nested list rules:**
- It follows `list-pagination` like every list (`limit`, `cursor`, `ids`; ordered by `permid_no`).
  The largest occurrence has 7 identifications, so in practice it is always one page. Conforming is
  cheaper than writing an exception into the spec.
- The root always lists first: its number is the Classic `occurrence_no` or was minted before its
  reidentifications.
- It offers no CSV.

### D7. `name`: one formatting rule, decided here

A display string composed from the rank block. The structured ranks remain the authoritative form.

| Rule | Example | Data (current heads) |
|---|---|---|
| Ranks in order, subgenus in parentheses | `Dielasma (Foo) bovidens` | |
| `?`, `cf.`, `aff.`, `ex gr.` go **before** the rank's name | `cf. Dielasma`, `Dielasma aff. bovidens`, `Dielasma (cf. Foo) bar` | e.g. genus `?` 46,701 |
| `n. gen.`, `n. subgen.`, `n. sp.`, `n. ssp.`, `sensu lato`, `sensu stricto` go **after** it | `Dielasma bovidens n. sp.` | species `n. sp.` 122,183 |
| `var`, `morph`, `forma`, `mut` (subspecies only) go before it, as stored | `… forma minor` | `forma` 1,157 |
| `informal`: qualifier dropped, name kept | | species 70,757 |
| `"` (ditto, "as the row above"): qualifier dropped, name kept | | genus 11,363 |
| Missing ranks are skipped; no ranks gives `name: null` | | |

`sp.`, `indet.`, `spp.` and `sp. 1` are stored as species *names* (339,631 `sp.`), so the formatter
synthesizes nothing.

The rule lives in `lib/identified-name.js`, which both the occurrence and the identification reads use.
The occurrence source declares `identification.name`, so CSV gets the column.

### D8. Filters on link columns

`collection`, `taxon` and `withinTaxon` are descriptor filters with a new kind of target: a column, not
a `jsonPath`.
- Their match kinds join `field-filter-ops.js`, so parameter schemas, strict-parameter recognition and
  descriptions come from the existing seam.
- They translate to SQL in `occurrence-repository.js`, not in the generic repository.

| Parameter | Value | Predicate |
|---|---|---|
| `collection` | a `COL` permid | `o.collection_id = (SELECT id FROM collections WHERE permid = $n AND succeeded_by_id IS NULL)` |
| `taxon` | a `TXN` permid | `o.taxon_permid = $n`: exactly the identified name |
| `withinTaxon` | a `TXN` permid | `o.taxon_permid = ANY(<every taxa row of every concept at or below $n's concept>)` |

**Value validation:** the value must look like a permid of the right prefix (`^COL-\d+-\d{2}$`), or the
request is a 400. A value of the wrong prefix cannot match anything, so an empty result would read as
"nothing matched". A well-formed permid that names nothing, including a wrong check digit, gives an
empty 200: check digits are the database's business (`cursor.js`).

**Composition:** filters combine with each other, with `ids` and with pagination (AND), like field
filters.

**`withinTaxon`:**
- **Synonyms.** It resolves `$n` to its accepted concept (`taxa.concept_permid`), so a synonym's permid
  gives the senior's whole subtree. Every synonym row shares its concept's `classification_path` (all
  162,988 checked), so the subtree includes the synonyms at every level.
- **Strategy.** It walks `containing_concept_permid` downward (`WITH RECURSIVE`), then takes every row of
  those concepts. GiST on `classification_path` is impossible at these path lengths
  (`db/03-taxa.sql:2297`). Page of 100:

  | Taxon | Names in subtree | Walk (chosen) | Path scan |
  |---|---|---|---|
  | *Tyrannosaurus* | 69 | 3 ms | 0.8–2.0 s |
  | Productidae | 550 | 12 ms | 180 ms |
  | Mammalia | 32,706 | 355 ms | 260 ms |
  | Brachiopoda | 31,401 | 300 ms | 1–4 ms |

  The walk never goes badly wrong; the path scan does on small subtrees. Choosing per query by subtree
  size is left for later.

**Why `taxon=` means exact (option c):** `taxon=` is the literal reading. The subtree is the common
question, but it gets its own name. If feedback says `taxon=` should mean the subtree, switch before
the API is public: afterwards it would change results silently for existing URLs, so the safe path
would be a new parameter, not a redefinition.

### D9. Payload sources and published components

- **`payloadSchemas/occurrence.schema.js`:** read-only at its root, like `taxon.schema.js`, with
  descriptive `x-storage`.
  - It reuses `identificationSource.properties.identification.properties` for the lifted ranks, so the
    resolution enums have one definition and `identification.schema.js` exports nothing new.
  - Property order fixes response and CSV order: `permid`, `collection`, `reference`, `identification`,
    `acceptedTaxon`, `plantOrgans`, `abundance`, `legacyIDs`.
  - `abundance` is `{ value, unit }` or `null`. The abundance's own permid, reference and people stay
    out until there is a route for them.
- **Published components:**
  - `Occurrence`, from that source.
  - `Identification`, from `identificationSource`'s `out` variant plus the API-composed `name`.
- `CollectionLink` joins the link components.
- `test/published.js` validates the reads of both routes.

### D10. Discovery and description

- `/api/v1` lists `occurrences`. Discovery lists route groups only, so the nested routes are not
  children there.
- The description documents all four GET operations. The nested ones are reachable through each
  embedded identification's `href`.
- The 405 write routes are hidden, as on `taxa`.

## Risks / Trade-offs

- **[Stale cache]** The cache is as current as the last `rebuild_occurrences()`, which today is the
  migration run. A `taxa` rebuild can change `acceptedTaxon` and `withinTaxon` results with no
  occurrence changing; that is correct, not drift. → No mitigation needed until there is a write path,
  which must rebuild with a seed.
- **[`withinTaxon` on large subtrees]** Every page re-walks the tree (about 150–350 ms for 30,000-name
  subtrees). A streamed CSV export of Mammalia (94,121 occurrences, 95 batches) would walk 95 times. →
  The repository resolves the taxon set once per request and reuses it across batches.
- **[Reading root vs. winner reference wrongly]** Clients may take `reference` to be the reference for
  the current name. → The names are kept apart (`reference` / `identification.reference`), and the
  published schema descriptions and `docs/` say which is which.
- **[Embedded vs. full record differ in shape]** The ranks are lifted in one and nested in the other.
  → The same descriptions are used in both components, and the difference is stated in the response
  docs.
- **[Winner changes outside this change]** The root-competes question with Andrew can change the winner
  on 774 occurrences. → The API reports whatever the cache holds, and nothing here encodes the rule.
- **[Name formatting vs. Classic]** D7 has not been compared with Classic's display. → It is recorded as
  an open question. The structured ranks carry the full information either way.

## Migration Plan

No database or data change. Deploying is an API release, and the tables are already loaded on
localhost and Aurora. Rolling back means removing the route group: nothing else depends on it.

## Open Questions

- **`informal` and the ditto mark in `name`:** does Classic's display mark informal names (for example
  with angle brackets)? D7 drops the qualifier; changing that is one rule in `identified-name.js`.
- **CSV on the nested identifications list:** left out (D6). Add it if anyone asks.
- **Per-query choice of `withinTaxon` strategy:** deferred until a measured need.
- **For Andrew, not blocking:**
  - root-competes (`docs/occurrences.md`);
  - whether the cache keeps its name-block copy (`docs/api-design-backlog.md`).
