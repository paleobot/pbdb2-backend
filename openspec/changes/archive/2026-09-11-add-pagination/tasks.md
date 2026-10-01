## 1. Cursor encoding

- [x] 1.1 Add `src/lib/cursor.js` with `encodeCursor({ permid, direction })` and `decodeCursor(token)` using base64url; document that the token is opaque so the encoding can change (e.g. a compound key) without a client-visible break
- [x] 1.2 `decodeCursor` returns a sentinel/throws a recognizable error for malformed input so the seam can turn it into a 400; never let a decode failure surface as a 500

## 2. Parse and validate in the shared seam

- [x] 2.1 In `src/lib/list-filters.js`, add `DEFAULT_LIMIT` (100) and `MAX_LIMIT` (1000) constants beside the existing `MAX_IDS`
- [x] 2.2 Extend `collectListFilters` to parse `limit`: absent → `DEFAULT_LIMIT`; empty, non-integer, zero, or negative → 400; above `MAX_LIMIT` → 400 (reject, do not clamp)
- [x] 2.3 Parse `cursor`: absent → no cursor; present but undecodable → 400; decoded → `{ permid, direction }`
- [x] 2.4 Reject `ids` combined with `limit` or `cursor` with a 400 naming the conflict
- [x] 2.5 Return pagination as a normalized part of the filter object (e.g. `{ ids?, fields?, page: { limit, cursor? } }`) so the handler receives one shape

## 3. Translate to SQL in the repository

- [x] 3.1 In `src/lib/repository.js`, extend `readHeads` to accept the page criteria and append the keyset predicate: forward → `permid > $n ORDER BY permid ASC`, backward → `permid < $n ORDER BY permid DESC`
- [x] 3.2 Apply `LIMIT $n` using `limit + 1` internally to detect whether a further page exists without a second query; return the extra row as a `hasMore` signal, not as data
- [x] 3.3 For a backward page, reverse the rows before returning so `data` is always ascending by `permid` regardless of travel direction
- [x] 3.4 Keep parameter binding correct as predicates are added (positional `$n` ordering) and preserve the "only permid + payload + projections, never internal ids" guarantee
- [x] 3.5 Verify a bare call with no page criteria still reproduces the previous query plus the default bound

## 4. Build the links at the route boundary

- [x] 4.1 In `src/lib/crud-routes.js`, construct `links.next` / `links.prev` from the page result: preserve every other query parameter of the current request, replacing only `cursor`
- [x] 4.2 `next` is `null` when no further page exists; `prev` is `null` when the request carried no cursor
- [x] 4.3 An `ids` read returns `null` for both links and keeps its `meta.requested` / `meta.missing` accounting unchanged
- [x] 4.4 Stub-backed reads (`specimens`, or any build with no DB) accept the parameters, return their stub list as one page, and set both links to `null`
- [x] 4.5 Confirm `src/plugins/envelope.js` passes real link values through unchanged; adjust only if the `null` defaults would override them

## 5. Bring `schemas` onto the shared seam

- [x] 5.1 Replace the direct `repository.list()` call in `src/routes/api/v1/schemas/index.js` with the same `collectListFilters` + `readHeads` path the uniform groups use
- [x] 5.2 Confirm `schemas` thereby gains `ids` and pagination; leave the single-read aggregate tree untouched and unpaginated
- [x] 5.3 Regression: unparameterized `GET /schemas` returns what it returned before, bounded by the new default

## 6. Tests

- [x] 6.1 First page: bare list returns at most `DEFAULT_LIMIT`, ordered by permid, `links.prev` null (fake-pg)
- [x] 6.2 Forward paging: walking `links.next` to exhaustion yields every head exactly once, in permid order, with `next` null on the final page
- [x] 6.3 Round trip: page forward then back via `links.prev` and assert the original sequence is recovered exactly (guards the reverse-keyset off-by-one and the re-reversal)
- [x] 6.4 Assert the emitted SQL binds `permid > $n` / `permid < $n` with the right ordering per direction, and `LIMIT limit + 1`
- [x] 6.5 Composition: pagination with a field filter narrows the same set and `links.next` preserves the filter param
- [x] 6.6 Validation: empty / zero / negative / non-integer / oversized `limit` each → 400; undecodable `cursor` → 400
- [x] 6.7 Conflict: `?ids=a,b&limit=10` and `?ids=a,b&cursor=…` each → 400
- [x] 6.8 `ids` read still reports `meta.requested` / `meta.missing` and carries null links
- [x] 6.9 Stub resource (`specimens`) with `?limit=` → 200, single page, null links
- [x] 6.10 Insert-stability: with a fake-pg that adds a row between pages, assert no pre-existing record is skipped or repeated

## 7. Verify

- [x] 7.1 Run `npm test` — all suites green, including the prior `ids`, field-filter, envelope, and discovery suites
- [x] 7.2 Run `npm run test:integration` against a real database if one is reachable; confirm the keyset queries execute and page correctly (note: this suite skips cleanly with no DB)
- [x] 7.3 Confirm the `links.next` / `links.prev` slots are no longer permanently null anywhere they should carry a URL, and that no response shape changed
