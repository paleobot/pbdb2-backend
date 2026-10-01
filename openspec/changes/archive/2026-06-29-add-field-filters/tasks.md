## 1. Declare field filters as data

- [x] 1.1 Add a `filters` map to the `references` descriptor in `src/lib/resource-tables.js`: `{ publication_type: { jsonPath: 'publicationType', op: 'eq' } }`; document the structure as source-agnostic (hand-authored now, schema-derivable later)
- [x] 1.2 Extend the `ResourceDescriptor` typedef with the optional `filters` field

## 2. Unify the head read into composable predicates

- [x] 2.1 In `src/lib/repository.js`, replace separate `list()` / `readHeads(permids)` with one `readHeads({ ids?, fields? })` that assembles `WHERE` from contributors: `HEAD_FILTER` always, `permid = ANY($n)` when `ids`, and one `<jsonbColumn>->>'<jsonPath>' = $n` per field filter (the `translate` stage)
- [x] 2.2 Keep parameter binding correct as predicates are added (positional `$n` ordering); preserve `ORDER BY permid` and the "only permid + payload + projections, never internal ids" guarantee
- [x] 2.3 Verify a bare read (no criteria) reproduces today's `list()` query and `ids`-only reproduces today's multi-get query (regression contract)

## 3. Parse & validate field filters in the seam

- [x] 3.1 In `src/lib/list-filters.js`, extend `collectListFilters(query, httpErrors, filterDefs)` to read the resource's declared `filters`, pull matching params from the query, and return them as a normalized `fields` object
- [x] 3.2 The `validate` stage: present-but-empty field-filter value → 400 (mirroring `ids`); values otherwise pass through as opaque strings (no enum check). Keep the stage explicit so schema-driven validation can later fill it
- [x] 3.3 Leave unrecognized query params ignored (lenient); do not reject them

## 4. Wire filters through the list handler

- [x] 4.1 In `src/lib/crud-routes.js`, pass the resource's filter definitions into `collectListFilters` and forward parsed `fields` (alongside `ids`) into `repository.readHeads({ ids, fields })`
- [x] 4.2 Ensure field filters apply only on the DB-backed path; a bare list with no filters keeps existing behavior

## 5. Tests

- [x] 5.1 `references?publication_type=book` → 200, only matching heads; assert the query binds `reference->>'publicationType' = $n` under the head filter (fake-pg)
- [x] 5.2 Composition: `?ids=a,b&publication_type=book` → only the requested ids that also match; assert a single composed `WHERE` with both predicates
- [x] 5.3 No-match value → 200 with empty `data` and no `meta.missing`
- [x] 5.4 Empty `?publication_type=` → 400
- [x] 5.5 Unknown query param is ignored (does not filter, does not 400)
- [x] 5.6 Regression: bare list and `ids`-only multi-get behave exactly as before through the unified read

## 6. Verify

- [x] 6.1 Run `npm test` — all suites green, including the prior `ids` and list suites unchanged
- [x] 6.2 Confirm no route files changed and other resources (authorities/collections/specimens) are unaffected (no `filters` declared → no field-filter params)
