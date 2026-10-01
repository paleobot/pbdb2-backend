## Why

The envelope has reserved `links.next` / `links.prev` since the scaffold, and
every list endpoint has returned every current head with no bound. That was
harmless while the DB-backed resources were small. It stops being harmless at the
next resource: `taxa` holds **517,226 rows** (measured 2026-09-10; see
`docs/taxa-classification-reads.md`), so an unbounded `GET /taxa` is a
half-million-row scan serialized into one response.

Pagination is also the last of the three cross-cutting list seams — after `ids`
(`add-multi-get-ids-filter`) and field filters (`add-field-filters`) — and it
should land the same way they did: one seam, all resources, before the resource
that forces it exists. Building it inside the taxa change would either give taxa
a bespoke limit that later gets ripped out, or quietly turn that change into a
six-resource refactor.

The mechanism question the scaffold deferred ("cursor vs offset") is already
answered by code in the repository: `readHeads` has always ordered by `permid`,
and every table indexes it (`<table>_permid_head_idx` from
`install_version_triggers`; `UNIQUE (permid)` on `taxa`). That is a keyset cursor
already built — it just needs to be exposed.

## What Changes

- Add **keyset pagination** to every list endpoint: `?limit=` and an opaque
  `?cursor=`, translated into `permid > $n ORDER BY permid LIMIT $n` over the
  same composed `WHERE` that `ids` and field filters already contribute to.
- **Fill `links.next` / `links.prev`** with real URLs instead of `null`
  placeholders. Both directions are supported; the cursor encodes its direction
  so a single param carries both.
- **Make `ORDER BY permid` normative.** It is currently an incidental detail of
  the repository; keyset correctness depends on a total, stable order, so it
  becomes a stated guarantee rather than an implementation accident.
- **Bound the default page.** A list with no `limit` returns at most
  `DEFAULT_LIMIT` (100, matching `MAX_IDS`); `limit` above `MAX_LIMIT` (1000) is
  rejected with `400`, as is a non-integer or non-positive `limit`.
- **`ids` and pagination are mutually exclusive.** A multi-entity read is capped
  at `MAX_IDS` and is inherently single-page; combining it with `limit`/`cursor`
  is rejected with `400` rather than silently ignored.
- **Route the `schemas` list through the shared seam.** Its handler currently
  calls `repository.list()` directly, bypassing `collectListFilters`, so it
  supports neither `ids` nor field filters today. Pagination is the occasion to
  join it up — it gains all three at once.
- **BREAKING (behavioral):** a bare `GET` on a list endpoint now returns at most
  100 records instead of all of them. No response *shape* changes; clients that
  assumed one unbounded page must follow `links.next`.

### Deliberately not included

- **No total count.** `meta.found` / `meta.returned` stay page-scoped. A true
  total needs a second `COUNT(*)` over the filtered set per request — on 517K
  rows that is a real cost for a number few callers need. An opt-in
  (`?count=true`) is the recorded follow-up if demand appears.
- No offset/page-number parameters, no sort-order parameter (both would
  destabilize the keyset), and no pagination of the `schemas` aggregate tree
  (nested characters/states are part of one resource, not a list).

## Capabilities

### New Capabilities

- `list-pagination`: the cursor contract — `limit` / `cursor` parameters, their
  validation, keyset semantics over a stable `permid` order, `links.next` /
  `links.prev` construction, and the interaction rules with `ids` and field
  filters.

### Modified Capabilities

- `api-foundation`: the reserved `links.next` / `links.prev` slots stop being
  placeholders and carry real values; the stable list ordering becomes a stated
  guarantee of the envelope's list contract.
- `resource-routes`: list endpoints accept `limit` / `cursor`; the `schemas` list
  is restated as going through the shared list-filter seam.

## Impact

- **Code:** `src/lib/list-filters.js` (parse/validate `limit` + `cursor`;
  `ids` conflict); `src/lib/repository.js` (keyset predicate, `LIMIT`, page
  metadata); `src/lib/crud-routes.js` (build `next`/`prev` from the page);
  `src/plugins/envelope.js` (accept real link values); a new small
  cursor encode/decode module; `src/routes/api/v1/schemas/index.js` (join the
  shared seam).
- **API:** additive parameters, but a behavioral break on unbounded list reads
  (see above). Response shape unchanged.
- **Downstream:** unblocks `add-taxa-reads`, which cannot ship an unbounded list.
