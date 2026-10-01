## Why

The API can fetch one resource at a time (`GET /references/{permid}`) or the
full list (`GET /references`), but has no way to fetch a specific *set* of
resources in one request. Clients that already hold a handful of `permid`s
(cross-references, search-result hydration, UI list rendering) must fan out into
N single requests. The classic PBDB data service solved this with
comma-separated ids in query params (e.g. `taxon_id=69296,70300`); paleo tooling
expects that idiom. This is also the first of *many* planned list filters, so it
is the moment to establish how query-param filtering composes rather than
bolting on a one-off.

## What Changes

- Add multi-entity reads to the uniform resource groups via a comma-separated
  `ids` query param on the existing list endpoint:
  `GET /references?ids=ref-1,ref-2`. No new route — the list handler gains a
  filter seam, and `ids` is its first contributor.
- Multi-get always returns a list envelope (`sendList`, `data` is an array),
  even for a single id. `GET /{permid}` remains the only singular read.
- Partial success: a request is `200` with the found subset; missing ids never
  fail the whole batch. The response reports `meta.requested` (distinct count),
  `meta.found`, `meta.returned`, and `meta.missing` (always present, empty array
  when all found).
- Set semantics: duplicate ids collapse; result order is not promised
  (`ORDER BY permid`), clients key by `permid`.
- Empty `?ids=` (param present, no value) → `400`; **no** `ids` param at all
  continues to mean "list everything" — the two are deliberately distinct.
- Batch cap of 100 ids; `>100` → `400`. A body-based `POST /{resource}/batch`
  escape hatch for larger sets is noted but deferred.
- Stub fallback (specimens, or any build with no DB) echoes the requested ids
  back as stub records, uniformly with the DB-backed path.
- New read-repository method `readHeads(permids)` — `list()` filtered by
  `permid = ANY($1)` under the existing head filter.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `resource-routes`: the read surface of the uniform resource groups gains a
  multi-entity read via the `ids` list filter, with the partial-success
  contract, the empty-vs-absent `ids` distinction, the batch cap, and the
  stub-echo fallback as new requirements.

## Impact

- **Code:** `src/lib/crud-routes.js` (list handler grows a query-filter seam);
  `src/lib/repository.js` (new `readHeads`); no route files change (uniform
  factory covers all four groups at once).
- **API:** additive — existing single and list reads are unchanged; `ids` is a
  new optional query param. No breaking changes.
- **Deferred:** `POST /{resource}/batch` body endpoint for large sets; broader
  query-filter set that will reuse the seam this change establishes.
