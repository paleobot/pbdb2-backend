## Context

Three cross-cutting list seams were planned; two exist. `add-multi-get-ids-filter`
introduced `collectListFilters` (the query seam) and
`add-field-filters` unified the repository into one composable head read
(`HEAD_FILTER` + optional `ids` + optional field predicates) and named the
pipeline's stages: `define` (the resource's declared filters) → `validate`
(request-derived checks, no DB) → `translate` (predicate construction in the
repository). Pagination is the third seam and fits the same three stages.

The scaffold deferred the mechanism question — cursor vs. offset — and reserved
`links.next` / `links.prev` as permanent `null`s in `plugins/envelope.js`. That
deferral can now be closed cheaply, because the repository has ordered by
`permid` since the first DB-backed read and every table indexes it:
`install_version_triggers` creates `<table>_permid_head_idx ON <table>(permid)
WHERE succeeded_by_id IS NULL`, and `taxa` declares `UNIQUE (permid)`. A stable,
unique, indexed ordering is exactly the precondition keyset pagination needs.

The forcing function is `taxa`: 517,226 rows, measured 2026-09-10 (see
`docs/taxa-classification-reads.md`). No existing resource is large enough to
have made unbounded lists hurt; taxa is, and `add-taxa-reads` cannot ship without
this.

## Goals / Non-Goals

**Goals:**

- Keyset pagination over `permid` on every list endpoint, composing with `ids`
  and field filters through the existing seam rather than beside it.
- Real `links.next` / `links.prev`, replacing the reserved placeholders.
- A bounded default page, so no list endpoint can return an unbounded result set
  even when a client sends no parameters.
- Promote `ORDER BY permid` from incidental implementation to stated contract.
- Bring the `schemas` list onto the shared seam, which it currently bypasses.

**Non-Goals:**

- Total result counts (a second `COUNT(*)` per request; recorded as a follow-up).
- Offset/page-number parameters or a client-selectable sort order — both break
  keyset stability, which is the whole basis of the design.
- Paginating the `schemas` aggregate tree, or any single-resource read.
- Anything taxa-specific; taxa consumes this seam in a later change.

## Decisions

### Keyset over `permid`, not offset

Pagination is `WHERE permid > $cursor ORDER BY permid LIMIT $n`, appended to the
same predicate list the `ids` and field filters already contribute to.

_Why:_ `OFFSET n` on a 517K-row table makes the database walk and discard `n`
rows per request, so deep pages degrade linearly, and concurrent inserts shift
every subsequent page (records get skipped or repeated). Keyset is O(index seek)
at any depth and is insert-stable, because it names a position in a total order
rather than a count of rows. The ordering and the indexes it needs already exist,
so this is the cheaper option to build as well as the better one to operate.

_Alternative considered:_ offset pagination, which is simpler to explain and
allows "jump to page N". Rejected because taxa is precisely the case where deep
offsets would be used and would hurt, and because "page N" is not meaningful over
a result set that changes between requests. `ids` already covers the
"fetch these specific records" need that page-jumping is usually a proxy for.

### The cursor is opaque and carries its direction

The cursor is an encoded token (base64url), obtained only from a `links.next` or
`links.prev` URL. It encodes the boundary `permid` and the direction of travel.

_Why opaque:_ it keeps the encoding an implementation detail. If a future
resource needs a compound key (say, `ORDER BY name, permid` for a taxa
name-search), the token's contents can change without a client-visible break —
whereas a raw `?after_permid=` parameter would freeze the mechanism into the
public contract on day one.

_Why direction-carrying:_ `prev` is the reverse keyset — `WHERE permid <
$cursor ORDER BY permid DESC LIMIT $n`, with the rows reversed before they are
rendered. Putting the direction inside the token keeps the public surface at one
parameter instead of two, and makes an inconsistent combination unrepresentable.

_Alternative considered:_ forward-only pagination, leaving `links.prev`
permanently `null`. Rejected because the envelope has promised both slots since
the scaffold, and the reverse predicate is a flipped comparison plus a re-sort —
a small amount of code to redeem a standing promise.

### Oversized `limit` is a 400, not a clamp

_Why:_ a silently clamped limit leaves the client believing it has seen more of
the result set than it has, which is the kind of bug that surfaces as missing
data much later. An explicit rejection is immediate and unambiguous. This also
matches the existing seam's disposition toward *values* it can see are wrong
(present-but-empty `ids` and field filters are already `400`s) while leaving the
lenient treatment of *unrecognized parameters* untouched.

### `ids` and pagination are mutually exclusive

_Why:_ `ids` is already bounded by `MAX_IDS` (100) and carries partial-success
accounting (`meta.requested` / `meta.missing`) that is only well-defined when the
id set is the sole constraint — the same reasoning that made `add-field-filters`
suppress that accounting under a field filter. Slicing an id set into pages would
make `missing` incoherent again (absent from this page, or absent entirely?).
Rejecting the combination states the incompatibility instead of silently
resolving it in a direction the client did not choose.

_Alternative considered:_ ignoring `limit`/`cursor` when `ids` is present.
Rejected as the silent-clamp problem in another costume.

### `meta.found` / `meta.returned` stay page-scoped; no total count

_Why:_ a true total requires a second query — `COUNT(*)` over the same filtered
predicate — on every request. Over 517K rows that is a material per-request cost
for a number most callers do not use, and it cannot be cached usefully because
it varies with every filter combination. Page-scoped counts are honest and free.

_Follow-up recorded:_ an opt-in `?count=true` can add the total later for the
callers that genuinely need it, without changing the default cost.

### `schemas` joins the shared seam

Its list handler calls `repository.list()` directly today, bypassing
`collectListFilters` — so it silently supports neither `ids` nor field filters.

_Why now:_ adding pagination to it requires touching that handler regardless.
Wiring it to the seam instead of special-casing it costs slightly more in this
change and removes a standing inconsistency, rather than deepening it. Its single
read stays bespoke — the aggregate tree is genuinely a different representation,
and that exception remains deliberate.

## Risks / Trade-offs

- **[A bare list read becomes bounded — a behavioral break]** → No response shape
  changes, and no consumer is known to depend on unbounded reads (the API has no
  production clients yet). The change is stated as BREAKING in the proposal, and
  `links.next` makes the continuation discoverable from the response itself.

- **[`ORDER BY permid` is uuid-v7 order, which is roughly creation order — not a
  meaningful sort for users]** → Correct, and out of scope: this change fixes the
  ordering as the *pagination* key, not as a presentation choice. A
  user-meaningful sort (taxa by name, say) would need its own compound cursor,
  which the opaque-token decision deliberately leaves room for.

- **[Reverse paging is the least-exercised path and easy to get subtly wrong —
  off-by-one at the boundary, or forgetting to re-reverse the rows]** → Test it
  as a round trip rather than in isolation: page forward through a known set,
  then back, and assert the original sequence is recovered exactly.

- **[Cursors could be inspected and hand-forged despite being "opaque"]** →
  Base64url is encoding, not protection, and no authorization decision depends on
  a cursor's contents; a forged cursor can only name a position in data the
  client may already read. Decode failures are rejected with `400`.

- **[Wiring `schemas` to the seam changes an endpoint this change is not
  primarily about]** → Its current behavior (list all heads) is reproduced
  exactly by a bare call through the seam, so the regression surface is a single
  assertion: unparameterized `GET /schemas` returns what it returned before, up
  to the new default bound.

## Open Questions

- `DEFAULT_LIMIT` is proposed at 100 (matching `MAX_IDS`) and `MAX_LIMIT` at
  1000. Both are guesses pending a real client; they are single constants and
  cheap to revise.
- Whether `taxa` will want a name-ordered compound cursor is left to
  `add-taxa-reads`. The opaque token is what keeps that option open.
