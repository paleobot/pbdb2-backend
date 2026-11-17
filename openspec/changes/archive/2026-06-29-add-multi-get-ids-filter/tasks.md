## 1. Repository: multi-head read

- [x] 1.1 Add `readHeads(permids)` to the read repository in `src/lib/repository.js`, reusing the existing `select` skeleton, `HEAD_FILTER`, and `toResource` — `WHERE permid = ANY($1) AND <HEAD_FILTER> ORDER BY permid`
- [x] 1.2 Confirm it returns `[]` (not an error) when no permids match, and never selects internal serial ids / version-chain columns

## 2. Filter seam in the list handler

- [x] 2.1 Add a `collectListFilters(query)` helper that normalizes query params into a filter object (today `{ ids? }`), splitting `ids` on commas, trimming, and deduping to a distinct set
- [x] 2.2 Enforce request-only validation in the helper: absent `ids` → no filter; present-but-empty / splits-to-zero → 400; `>100` distinct ids → 400 (use `fastify.httpErrors.badRequest`)
- [x] 2.3 Wire the seam into the `GET /` handler in `src/lib/crud-routes.js`: when `ids` filter present, take the multi-get path; otherwise keep the existing list-all behavior

## 3. Multi-get path & partial-success accounting

- [x] 3.1 DB-backed branch: call `repository.readHeads(ids)`, hydrate each record, then compute `requested` (distinct count), `missing` (requested minus found `permid`s) at the route boundary
- [x] 3.2 Stub fallback branch (no repository): map each requested id through `stub(id)`, one record per id, `missing` empty
- [x] 3.3 Return via `sendList` with `meta` carrying `type`, `requested`, and `missing` (always present, empty array when none); `found`/`returned` come from `sendList`

## 4. Tests

- [x] 4.1 Multi-get happy path: `?ids=` with several existing ids → 200, array of exactly those, `meta.missing` empty (DB-backed via fake pg)
- [x] 4.2 Partial success: mix of existing and unknown ids → 200, found subset in `data`, unknown ids in `meta.missing`
- [x] 4.3 Single id still returns an array; duplicate ids collapse; `requested` is the distinct count
- [x] 4.4 Empty `?ids=` → 400; no `ids` param → 200 lists all (regression on existing list behavior)
- [x] 4.5 Over-cap (`>100` ids) → 400; at-cap (100) accepted
- [x] 4.6 Stub fallback (specimens / no-DB build): `?ids=` echoes one stub per id, `meta.missing` empty

## 5. Verify

- [x] 5.1 Run `npm test` — all suites green
- [x] 5.2 Confirm the four uniform groups (references, authorities, collections, specimens) all expose the behavior through the shared factory, with no per-route changes
