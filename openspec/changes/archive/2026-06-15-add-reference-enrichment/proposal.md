## Why

Resource reads currently return only a resource's own JSONB payload plus its
`permid`; the references each resource cites live behind foreign keys and are
invisible to clients. Resolving a citation today requires a client to already
know it has a reference and to make a second request with an id it cannot see.
This change is the first slice of the deferred relationship-enrichment work: it
surfaces the references that `authorities`, `collections`, and `schemas` cite,
directly in their read responses.

## What Changes

- **Authorities reads gain a `reference` field** — an object `{ title, permid,
  href }` resolved from the `authorities.reference_id` foreign key.
- **Collections and schemas reads gain `primaryReference`** (an object of the
  same shape, from the main-table `reference_id`) **and `additionalReferences`**
  (an array of those objects, from the `additional_collection_refs` /
  `additional_schema_refs` join tables).
- **Enriched references embed in `data`** as domain fields (not in the envelope
  `links`), and each carries an `href` (`/api/v1/references/{permid}`) so the
  same object is navigable in both single reads and list items.
- **Removed references are suppressed everywhere**: a soft-removed primary
  reference resolves to `null`; soft-removed additional references are dropped
  from the array.
- **`title` is read from the reference JSONB** (`reference->>'title'`), a
  required element across all publication types.
- **Both read paths are enriched**: the generic head-read repository (list +
  single for the uniform resources, and the schemas list) and the hand-written
  schema aggregate-tree single read.
- **No-DB stubs are updated** so the DB-absent response shape matches the
  DB-present one. No envelope mechanics change, no new dependencies, no route
  handler logic changes beyond stubs and the `href` hydration wiring.
- **Specimens is explicitly deferred** (no backing table yet) and will follow
  the collections/schemas primary + additional pattern when its table lands.

## Capabilities

### New Capabilities

- `reference-enrichment`: read responses for citing resources embed their
  referenced `refs` as `{ title, permid, href }` objects — a single `reference`
  for authorities, `primaryReference` + `additionalReferences` for collections
  and schemas — with removed references suppressed and `href` hydrated at the
  route boundary.

### Modified Capabilities

<!-- No existing requirement changes its meaning: data-access head reads and
     resource-routes response shapes remain as specified; enrichment adds new
     behavior captured by the new capability above. -->

## Impact

- **New capability spec:** `openspec/specs/reference-enrichment/`.
- **Code:**
  - `src/lib/resource-tables.js` — descriptors for `authorities`,
    `collections`, `schemas` gain a declarative `references` field
    (`primary { as, via }`, `additional { as, joinTable, joinKey }`).
  - `src/lib/repository.js` — `makeReadRepository` builds reference projection
    sub-selects from the descriptor and merges them into each record; a shared
    `refProjectionSql` helper (with the removed-suppression filter) is the single
    source for the projection fragment.
  - `src/lib/schema-tree.js` — the aggregate single read reuses the same helper
    to add `primaryReference` / `additionalReferences`.
  - Route/envelope boundary — a descriptor-driven `href` hydration step adds
    `href` from `permid`, keeping the data layer HTTP-agnostic.
  - Route stub builders (`authorities`, `collections`, `schemas`) — include the
    reference fields.
- **Tests:** integration seeders (`insertAuthority`, `insertCollection`,
  `insertSchema`, `insertAdditionalCollectionRef` / `…SchemaRef`); integration
  assertions including an edit-then-reread (proves FK swing tracks head) and a
  removed-reference-suppression case; a repository unit test for the projection
  SQL and merge against the fake `pg`.
- **No changes to:** dependencies, the `{ data, meta, links }` envelope, auth,
  or the write path. Reads against `refs` themselves are unchanged.
