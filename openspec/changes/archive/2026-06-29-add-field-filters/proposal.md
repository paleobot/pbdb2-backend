## Why

The list endpoint can now narrow by identity (`?ids=`), but not by content. The
first real demand is an entity-specific filter — `GET /references?publication_type=book`
— and it differs from `ids` in kind: it is references-only and reads a field
*inside* the JSONB payload, not the row identity. That difference is the useful
forcing function: it is where the "filter seam" claimed by the `ids` change
either becomes real or stays a story. Building `publication_type` as a one-off
would be cheap now and expensive at filter #3; building it as the first
*per-entity field filter* — over a unified, composable read — is the design that
holds.

## What Changes

- Add per-entity **field filters**: declared per resource, parsed by the shared
  seam, and composed into the head read. The first instance is
  `references?publication_type=<value>`, matching `reference->>'publicationType'`.
- **Unify the read into composable predicates.** Collapse the repository's
  separate `list()` and `readHeads(ids)` into one head-select that assembles its
  `WHERE` from contributors (`HEAD_FILTER` + optional `ids` + optional field
  predicates). This lets `?ids=a,b&publication_type=book` compose instead of
  forking into method combinations.
- **Declare filters as data, in the descriptor.** `resource-tables.js` gains a
  `filters` map per resource (`{ publication_type: { jsonPath: 'publicationType',
  op: 'eq' } }`) — parallel to the existing `references` enrichment config. The
  seam reads it; route files do not change. The structure is deliberately
  source-agnostic so a future JSON-Schema loader can produce the same
  declarations.
- Field filters are pure filters: a value that matches nothing yields an empty
  `200` (no `meta.missing` — that accounting belongs to the `ids` set semantics).
- Validation mirrors the `ids` precedents: present-but-empty value → `400`;
  values are otherwise treated as opaque strings (no enum check); duplicate /
  unknown query params are ignored (lenient).
- **Separate the filter pipeline into `define` → `validate` → `translate`
  stages** over the data declaration, keeping each stage as thin as today's need
  — so schema-driven validation can later fill the `validate` stage without
  reshaping consumers.

### Deferred follow-ups (recorded, not built)

Two behaviors are intentionally lenient now and SHALL tighten when the
`pbdb2-dev` JSON Schemas are wired in — framed as provisional so the later
tightening is a planned step, not a surprise breaking change:

- **Unknown query params** are ignored today; a future strict mode MAY reject
  unknown params with `400`, reading the valid field set from the schema.
- **Unknown filter values** yield an empty result today; with an enum-bearing
  schema, an out-of-enum value MAY become a `400`.

Also deferred: multi-value field filters (`=book,journal article` → `IN`),
non-`eq` operators (ranges, type-coerced fields), and the JSONB expression index
(`((reference->>'publicationType'))`) that real-world performance will want —
that index lives in `pbdb2-migrations`, not this repo.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `resource-routes`: the list endpoint gains per-entity field filters and the
  composable head read; the multi-entity `ids` read is restated as one
  contributor to the same composed `WHERE`.

## Impact

- **Code:** `src/lib/resource-tables.js` (new `filters` declaration);
  `src/lib/list-filters.js` (parse/validate declared field filters; the
  `validate` stage seam); `src/lib/repository.js` (unify `list`/`readHeads` into
  one predicate-assembled head read); `src/lib/crud-routes.js` (pass field
  filters through). No route-file changes.
- **API:** additive — existing single, list, and `ids` reads are unchanged;
  `publication_type` is a new optional query param on `references`. No breaking
  changes.
- **Cross-repo:** a `pbdb2-migrations` expression index is the performance
  follow-up; the API ships correct-but-unindexed.
