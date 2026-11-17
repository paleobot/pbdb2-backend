## Context

Reads today come in exactly two shapes, both in `src/lib/crud-routes.js`:
`GET /` → `repository.list()` → `sendList` (array), and `GET /:permid` →
`repository.readHead(permid)` → `sendData` (object). The repository
(`src/lib/repository.js`) builds one `select` skeleton and applies a shared
`HEAD_FILTER` (`succeeded_by_id IS NULL AND NOT removed`). When no DB is
configured (or for `specimens`, which has no table), routes fall back to
`stub()`. The factory serves all four uniform groups, so anything added there
lands everywhere at once.

This change adds multi-entity reads. The public shape is settled — a
comma-separated `ids` in the query string, not an overloaded path param; this
document settles how it threads through the handler and repository, and —
because many more list filters are coming — how query-param filtering composes
so this one doesn't become a special case the next filter has to route around.

## Goals / Non-Goals

**Goals:**

- Multi-entity read on the existing list endpoint via `?ids=a,b,c`, uniform
  across all four resource groups.
- Establish a reusable query-filter seam in the list handler; `ids` is its first
  contributor, not a bespoke branch.
- Pin the partial-success contract: 200 + found subset, `meta.missing` always
  present, set semantics, batch cap.
- Keep the singular (`/:permid` → object) and plural (list → array) shapes
  cleanly separated.

**Non-Goals:**

- A body-based `POST /{resource}/batch` endpoint (deferred escape hatch for
  large sets).
- Any further filter (`year`, `removed`, …) — only the seam plus `ids`.
- Order guarantees, cursor/offset pagination (envelope already reserves the
  slots), or write-verb changes.

## Decisions

### `ids` is a list filter, not a new route

Branch inside the existing `GET /` handler on parsed query filters rather than
adding a route or sniffing the path. This keeps `/:permid` as the only singular
read and means the multi-get inherits `sendList` for free. _Alternative:_ a
distinct `/batch`-style GET route — rejected as a parallel read path that would
diverge in serialization from `list()`.

### A filter seam, parsed once, contributed to `list()`

Introduce a small `collectListFilters(request.query)` step that produces a
normalized filter object (today `{ ids?: string[] }`), and extend the repository
`list` to accept optional filter criteria that contribute predicates to the
single assembled `WHERE`. `ids` becomes one predicate (`permid = ANY($1)`)
`AND`-ed onto `HEAD_FILTER` — the head-select skeleton is untouched. Concretely
this is a new `readHeads(permids)` (or `list({ ids })`) on the repository that
reuses `select`, `HEAD_FILTER`, and `toResource`. _Alternative:_ inline the
`ids` `if` in the handler and a one-off repo method — rejected because the next
filter would bolt on a second branch and a second method; the seam makes filter
#2 a contributor, not a refactor.

### Partial success computed at the route boundary

The repository returns whatever heads exist for the requested set; the handler
computes the accounting against the *requested* set: `requested` = distinct
input count, `missing` = requested minus the `permid`s present in the result.
This keeps the persistence layer HTTP-agnostic (mirrors how `href` hydration
already lives at the boundary, not in SQL). `meta.missing` is always emitted
(empty array when none), so clients get a stable shape. `found`/`returned` come
from `sendList`'s existing count logic.

### Validation order: parse → reject → query

`collectListFilters` enforces the cheap, request-only rules before any DB work:
absent `ids` → no filter (list all); present-but-empty (or splits to zero ids)
→ 400; `>100` distinct ids → 400. `permid`s are opaque strings, so there is no
per-id format check — an unknown id is simply absent from the result and lands
in `missing`. Use `fastify.httpErrors.badRequest(...)` (the sensible plugin) for
the 400s, matching the existing error shape.

### Stub fallback echoes the requested ids

When `repository` is absent, a multi-get maps the requested ids through `stub()`
(one stub per id) so the shape matches the DB-backed path: array data,
`meta.missing` empty. This keeps `specimens` and no-DB builds uniform with the
real path instead of returning a single stub or 404.

## Risks / Trade-offs

- **URL-length wall on big batches** → 100-id cap returns a clear 400; the
  deferred `POST /batch` is the documented escape hatch, envelope-compatible so
  it won't fork the read path later.
- **Seam over-engineering for a single filter** → kept deliberately minimal (a
  parse step + an optional criteria arg); the payoff is real because the
  proposal explicitly anticipates many more filters. If that turned out false,
  the seam is still a thin function, not a framework.
- **Order not guaranteed surprises a client** → documented in the spec
  (`ORDER BY permid`, key by `permid`); avoids the `ANY()` order-preservation
  trap. Mitigated by every record carrying its `permid`.
- **Filter param collides with a future reserved query key** (e.g. pagination
  `cursor`) → `collectListFilters` owns the namespace and can reserve keys; only
  `ids` is claimed now.
