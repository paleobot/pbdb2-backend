## Context

The reads-pg layer (archived `add-reads-pg-layer`) deliberately left
relationship enrichment out, but shaped the code to grow into it: the resource
descriptor in `src/lib/resource-tables.js` is documented as carrying an optional
`relationships` field consumed by one generic repository engine, and the
`{ data, meta, links }` envelope reserves `links` for relationships. That change
also recorded three open questions blocking enrichment: pin-to-version vs.
link-to-lineage, links vs. embedding, and how to express the `additional_*_refs`
many-to-many join tables.

This change resolves all three for the reference slice. The backend schema
(`pbdb2-migrations/postgresql/create_new.sql`) gives:

- `authorities.reference_id` (NOT NULL) → `refs.id` — one primary reference.
- `collections.reference_id` (NOT NULL) + `additional_collection_refs
  (collection_id, reference_id)` — primary plus many.
- `schemas.reference_id` (NOT NULL) + `additional_schema_refs (schema_id,
  reference_id)` — primary plus many.
- `title` lives in the `refs.reference` JSONB; `permid` is a column on `refs`.

Critically, `swing_fks_to_new_version` (create_new.sql:78) rewrites **every**
inbound FK (except lineage columns) from an old version to the new head whenever
any row is re-versioned. So `reference_id` and the join tables' FKs continuously
track the current head — the pin-vs-version question is moot for reads.

## Goals / Non-Goals

**Goals:**

- Embed each cited reference as `{ title, permid, href }` in read responses:
  `reference` for authorities; `primaryReference` + `additionalReferences` for
  collections and schemas.
- Keep enrichment declarative — a `references` field on the descriptor consumed
  by the one generic repository engine, plus the schema-tree exception reusing
  the same SQL helper.
- Suppress soft-removed references everywhere; never emit a dangling `href`.
- Keep the persistence layer HTTP-agnostic; hydrate `href` at the boundary.
- Match stub and DB-backed response shapes.

**Non-Goals:**

- `specimens` enrichment (no backing table yet).
- Enriching any non-reference FK (ages, enterer/authorizer, reference_type).
- Top-level envelope `links.relationships` / HATEOAS relationship links — left
  for the holistic relationship-links design.
- Embedding (`?embed=`) opt-in, pagination, or the write path.
- A version-pinned reference (the `/versions` sub-resource is still deferred).

## Decisions

### Decision: Descriptor carries a declarative `references` field

`resource-tables.js` descriptors for the three citing resources gain a
`references` object — the concrete instance of the `relationships` slot the
reads-pg design anticipated:

```js
authorities: {
  table: 'authorities', jsonbColumn: 'authority',
  references: { primary: { as: 'reference', via: 'reference_id' } },
},
collections: {
  table: 'collections', jsonbColumn: 'collection',
  references: {
    primary:    { as: 'primaryReference',     via: 'reference_id' },
    additional: { as: 'additionalReferences', joinTable: 'additional_collection_refs', joinKey: 'collection_id' },
  },
},
schemas: { /* same, additional_schema_refs / schema_id */ },
```

`references`/`specimens` carry no `references` and behave exactly as today.
Single-FK references use `primary`; many-to-many use `additional` with the join
table and its FK back to the citing resource. **Alternative considered:**
per-entity repository modules — rejected as before; the non-uniformity is
declarative data, not control flow.

### Decision: One shared `refProjectionSql` helper, two consumers

A single helper builds the projection fragment so the generic engine and the
schema-tree read cannot drift:

- **Primary** (scalar): a sub-select on `refs r WHERE r.id = t.reference_id AND
  NOT COALESCE(r.removed, false)` returning
  `json_build_object('title', r.reference->>'title', 'permid', r.permid)` (or
  `NULL` when removed/absent), aliased to the descriptor's `as`.
- **Additional** (array): `COALESCE(json_agg(json_build_object(...)) , '[]')`
  over `joinTable j JOIN refs r ON r.id = j.reference_id WHERE j.<joinKey> = t.id
  AND NOT COALESCE(r.removed, false)`, aliased to the descriptor's `as`.

`makeReadRepository` appends these aliased expressions to its head-select and
`toResource` merges the resulting columns into the record by their `as` key.
Both `readHead` and `list` get enrichment with no route changes.

`schema-tree.js` adds the same primary/additional sub-selects (correlated on the
`target_schema` head) to its final select and surfaces them in `assemble`'s
output. This is the one hand-written touch — `schemas` is enriched on both paths:
its list goes through the generic engine, its single read through the tree.

The projection reads `title`/`permid` directly off the referenced row — no head
re-resolution — because the swing trigger keeps `reference_id` pointed at the
head (see Context). `permid` is the stable lineage id; `title` is the current
head's title.

### Decision: Suppress removed references in SQL, hydrate `href` at the boundary

Soft-removal is filtered in the projection sub-selects (`NOT COALESCE(r.removed,
false)`): a removed primary yields `NULL`; removed additional rows drop out of
the `json_agg`. Filtering in SQL (not post-hoc in JS) keeps suppression in one
place and guarantees the array count is correct.

`href` is **not** built in SQL. The persistence layer emits `{ title, permid }`;
a descriptor-driven hydration step at the route/envelope boundary walks the
resource's reference fields (known from the descriptor's `as` keys) and sets
`href = <references base>/{permid}`. Because it reads from the
already-suppression-filtered data, no `href` can point at a removed reference,
and the data layer stays free of HTTP/route knowledge. The same step runs for
single reads and for each item in a list, so navigability is uniform.

The references base path is **derived from the route, not hard-coded**. Each
citing route group is mounted under an autoloaded prefix (`fastify.prefix`, e.g.
`/api/v1/collections`); its parent is the API version base (`/api/v1`), to which
the hydration step appends `/references`. This is computed once per route group
at registration (no per-request cost) and adapts automatically to a future `v2`
mount — there is no literal `/api/v1` in the hydration code. For the current
single mount this yields `/api/v1/references/{permid}`, matching the value the
spec scenarios assert.

**Alternative considered — references in top-level envelope `links`:** rejected.
`links` is per-response, so it cannot attach a link to each item of a list; the
one-primary-plus-N-additional cardinality forces a sub-shape that collides with
the deferred holistic relationship-links convention. Embedding `href` inside each
reference object (as HAL/JSON:API do for linkage) gives the same navigation in
single reads and list items with no envelope change and no pre-commitment.

### Decision: `title` from `reference->>'title'`

`title` is a required element across all publication types, so
`reference->>'title'` is a safe single source. Type-specific title variants are
out of scope.

## Risks / Trade-offs

- **Correlated sub-selects on list reads** (one primary + one `json_agg` per
  row) → acceptable for today's small tables, and indexed by `refs.id` /
  the join FK; revisit with pagination if tables grow.
- **Swing-trigger assumption** (that `reference_id` and join FKs track head) is
  load-bearing → covered by an integration edit-then-reread test against the
  real triggers, not just asserted in prose.
- **`title` absent for some reference rows** → `reference->>'title'` yields
  `null` cleanly; the object still carries `permid` + `href`.
- **Stub/DB shape drift** → stubs updated in the same change and asserted, so the
  no-DB shape matches.
- **`href` base path is derived from the route** (`fastify.prefix` parent +
  `/references`) rather than hard-coded → adapts to a future `v2` automatically;
  the assumption it encodes is that the `references` group is a sibling of every
  citing group under the same version prefix, which holds for the current
  autoload layout. The hydration helper remains the single point to update if
  that layout changes.

## Open Questions

- None blocking. The broader relationship-links convention (top-level
  `links.relationships`, version-pinned references via `/versions`, and
  enrichment of non-reference FKs) remains deferred to its own change.
