## Why

The base paths `/`, `/api`, and `/api/v1` currently return 404. A client that
lands on the API root has no way to discover what's available. Following the
hypermedia approach of data.azgs.arizona.edu, each rung of the path should
answer with a document that links to its children, making the API
self-describing and navigable.

## What Changes

- Serve index/discovery documents at the three base paths `/`, `/api`, and
  `/api/v1` (today all 404).
- Each index document uses the existing `{ data, meta, links }` envelope — no
  second response shape. `data` describes the node, `links` enumerates its
  immediate children (plus `self`), and `meta.type` is `index`.
- **Derive the child links from the registered route tree**, not a hardcoded
  list: for a base path `P`, its links are the distinct next path-segments of
  every route registered under `P/`. Adding a resource folder (or a future API
  version) makes it appear in discovery automatically.
- Compute the link maps once at boot (after routes are registered) and serve the
  precomputed documents — no per-request route walking.
- Genuinely unknown paths (e.g. a misspelled resource) still return the
  structured 404; only the known index paths gain a document.

## Capabilities

### New Capabilities
- `api-discovery`: Index/discovery documents at the API base paths, with child
  links derived from the registered route tree so they stay in sync with the
  routes that actually exist.

### Modified Capabilities
- `api-foundation`: The "Versioned API base path" requirement currently states
  that paths outside the version prefix return 404. This is refined so the known
  index paths (`/`, `/api`, `/api/v1`) are served, while unknown paths still
  404.

## Impact

- **New code:** a discovery plugin under `src/plugins/` (an `onRoute` collector,
  an `onReady` builder for the link maps, and handlers for the three index
  paths).
- **No new dependencies** — uses Fastify's built-in route introspection.
- **Tests:** add coverage for the three index documents, the derived links, and
  that unknown paths still 404.
- **Affected spec:** delta to `api-foundation` (the 404 requirement); new
  `api-discovery` spec.
- **No breaking changes** — paths that returned 404 now return useful documents;
  existing resource routes are untouched.
