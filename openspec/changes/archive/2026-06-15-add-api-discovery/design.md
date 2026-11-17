## Context

The scaffold serves resource collection roots (e.g. `/api/v1/references`) but
leaves the base paths `/`, `/api`, and `/api/v1` returning 404. We want them to
return hypermedia index documents (in the spirit of data.azgs.arizona.edu) so
the API is self-describing.

A constraint settled during exploration: this must NOT introduce a second
response shape. The project deliberately chose the `{ data, meta, links }`
envelope over AZGS-style `{ desc, links: [] }` (see
`docs/api-response-envelope-comparison.md`). Discovery therefore reuses that
envelope — `links` is already the slot for related URLs.

## Goals / Non-Goals

**Goals:**
- Index documents at `/`, `/api`, and `/api/v1`, each in the `{ data, meta, links }`
  envelope with `meta.type` of `index`.
- Child links derived from the registered route tree, so discovery stays in sync
  as resources (and future versions) are added or removed.
- Zero per-request route walking — compute once at boot.

**Non-Goals:**
- No change to resource collection roots or single-resource responses.
- No links on the 404 error body ("404 carries a link home" is a separate,
  later concern).
- No `create`/template affordances on collection list responses.
- No new dependency — Fastify's own route introspection is sufficient.

## Decisions

### Uniform derivation rule
For a base path `P`, the discovery links are the **distinct next path-segments
of every registered route whose path starts with `P/`**. Applied to the current
routes this yields: `/` → `{ api }`, `/api` → `{ v1 }`, `/api/v1` → the five
resources. The resource routes alone are sufficient to derive the whole chain.

**Why:** one rule covers all three rungs and any future ones (a `v2/` folder
makes `/api` list both versions). **Alternative rejected:** a hardcoded link map
per index path — trivial, but drifts silently out of sync with the routes that
actually exist, which undermines trust in a discovery endpoint.

### Collect routes via an `onRoute` hook, build maps in `onReady`
A discovery plugin registers an `onRoute` hook that records each route's path
into an inventory, then an `onReady` hook builds the three link maps once from
that inventory. The index handlers serve the precomputed documents.

**Why:** the route table is fixed after boot, so computing per request is waste.
`onRoute` is the supported introspection path. **Alternative rejected:**
walking the router (`find-my-way`) at request time — slower and reaches into
internals.

### Plugin ordering and encapsulation
The discovery plugin is `fastify-plugin`-wrapped (like the other plugins) so its
`onRoute` hook is attached to the root instance and sees the resource routes.
Plugins autoload before routes, so the hook is in place before any resource
route registers.

**Why:** `onRoute` only fires for routes registered in the same scope and after
the hook is added; root scope + early registration guarantees full coverage.

### Links shape matches the rest of the API
Each index document's `links` is an object keyed by relation name (`self`, then
one key per child), consistent with how resource responses already express
`links`. `self` is always present.

**Why:** keyed object (vs. AZGS's `[{rel, href}]` array) is the form already in
use; consistency over mimicry.

## Risks / Trade-offs

- **Derivation surfaces a path we didn't mean to advertise** (e.g. an internal
  health route added later) → The rule lists immediate child segments of
  registered routes; keep non-public routes out of the discoverable prefix tree,
  or add an explicit exclusion list if that need arises.
- **`onRoute` misses routes if the hook is registered too late** → Mitigated by
  plugin load order (plugins before routes) and root-scope (`fastify-plugin`)
  registration; a test asserts all five resources appear under `/api/v1`.
- **Trailing-slash / param routes pollute child segments** (`/:permid`) →
  Dedupe by next segment and ignore parameterized segments; `references` appears
  once whether or not `/:permid` exists.

## Open Questions

- Whether `/` should list its immediate child (`api`) or jump straight to
  `v1`/resources. Leaning immediate-child for uniformity (each rung lists only
  its direct children); easy to revisit.
- Exact `data` contents per index node (name/description/version) — cosmetic,
  settle during implementation.
