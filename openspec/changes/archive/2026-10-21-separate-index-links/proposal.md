## Why

On the three index documents (`/`, `/api`, `/api/v1`), `links` mixes two vocabularies. Some keys
are registered link relations (`self`, `describedby`). The rest are child path names
(`references`, `taxa`, `api`, `v1`), and `docs` is neither. A client cannot tell from the key which
kind it reads, and a child named like a relation would collide with it. Everywhere else in the API,
`links` holds only registered relations (`self`, `next`, `prev`), so the index is the exception.
`add-openapi-for-reads` made this visible by adding `describedby` and `docs` beside the resources
(explore session, 2026-10-21).

## What Changes

- **BREAKING:** on all three index documents, child paths move from `links` to
  `data.resources`, a map from each child's name to its absolute URL. The children are the index's
  content, so they belong in `data` with the node's description. This is also where the per-resource
  detail deferred in `add-openapi-for-reads` (D10) would go.
- **BREAKING:** `links` on an index holds only registered link relations: `self` on all three, and
  on `/api/v1` the two relations RFC 8631 defines for an API description:
  - `service-desc` → `/api/v1/openapi.json`, the machine-readable description (replaces
    `describedby`);
  - `service-doc` → `/api/v1/docs`, the human-readable documentation (replaces `docs`, which is not
    a registered relation).
- The published index schema (`INDEX_ENVELOPE`) and so the OpenAPI document describe the new shape.
- Unchanged: how children are derived (from the route table, hidden routes skipped), which children
  each index lists, the envelope and `meta.type: index`, and every non-index response.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `api-discovery`: "Base path discovery documents" changes. Children are listed in
  `data.resources`, `links` carries only relations, and `/api/v1` links its description as
  `service-desc` and `service-doc`. "Discovery links derived from the route tree" keeps its rules,
  but they now describe `data.resources` entries rather than `links` entries.

## Impact

- **Code (`api/`):** `src/plugins/discovery.js` (builds `data.resources` and the relation links),
  `src/plugins/envelope.js` (`INDEX_ENVELOPE`; `sendIndex` unchanged).
- **Tests:** `test/discovery.test.js`; `test/openapi.test.js`, whose coverage walk follows the
  index's `links` and would follow `data.resources` instead.
- **Docs:** `api/CLAUDE.md` (the description's links).
- **Clients:** any client reading `links.<resource>`, `links.describedby` or `links.docs` from an
  index must read `data.resources.<resource>`, `links["service-desc"]` or `links["service-doc"]`.
  None is known; the frontend's use of the index is to be checked.
- **Data integrity:** none. Read path only; no stored data and no resource response changes.
