## Why

`add-openapi-for-reads` will publish the GET contract, and publishing turns accidents into promises.
Three parts of today's response shape say something untrue or redundant. Nobody outside the team
consumes the API yet, so fixing them now is free; once they are documented, every fix is a breaking
change. This change lands first, so that the OpenAPI change documents an API that is already clean
and its review does not have to weigh shape changes too. The analysis is in
`openspec/changes/add-openapi-for-reads/design.md` (explore session, 2026-10-21).

## What Changes

- **BREAKING (response shape):** list and `ids` responses drop `meta.found`. It is page-scoped by
  design (`add-pagination`: no `COUNT(*)` per request) and therefore always equals `meta.returned`;
  the second name only suggests a total. A total, under whatever name, returns with the recorded
  opt-in `?count=true`, when a caller needs it.
- **BREAKING (query parameters):** field filters are named exactly like the payload field they
  match, in camelCase: `?publication_type=` becomes `?publicationType=`. This is the reasoning
  `add-taxa-reads` used for `includeContainingTaxa` (derivable from the field name), applied to
  filters. The descriptor's param → `jsonPath` mapping becomes the identity. No alias is kept.
- **BREAKING (response shape):** single reads drop `meta.removed` and `meta.version`. Neither can
  carry information under the current design: a GET serves only current, non-removed heads (so
  `removed` is always `false` and `supersededBy` always `null`), and versions share their lineage's
  `permid` (`db/02-core.sql`), so there is no public identifier `supersedes` could hold. On `taxa`
  neither applies at all. They return, with real values, alongside the deferred `/versions`
  sub-resource, which must also decide what a public version identifier is. `meta.type` stays.
- `api/docs/api-response-envelope-comparison.md` §2 examples (`"found": 1240`, a populated
  `version`) are corrected so they no longer imply a total or a version lineage.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `api-foundation`: the "Standard response envelope" requirement no longer reserves `meta.version`
  or `links` relationship entries (never written; relationships are inline links in `data`) on
  single responses; list `meta` carries `returned` (and `requested`/`missing` for `ids`).
- `list-pagination`: "Page-scoped result counts" is stated in terms of `meta.returned` only, and the
  opt-in total stays a recorded follow-up.
- `resource-routes`: the field-filter requirements and scenarios name `publicationType`, and state
  that a filter parameter is the name of the payload field it matches; the `ids` read's `meta`
  accounting drops `found`.
- `data-access`: scenarios that name the `publication_type` filter are updated.

## Impact

- **Code (`api/`):** `src/plugins/envelope.js` (`sendData`, `sendList`), `src/lib/crud-routes.js`
  (`ids` meta), `src/lib/resource-tables.js` (the filter name).
- **Tests:** assertions on `meta.found`, the `publication_type` param and the placeholder `meta`
  fields across the unit and integration suites (envelope, pagination, field-filters, multi-get,
  repository, link-enrichment, source-reads, taxa, integration reads).
- **Docs:** `api/CLAUDE.md`, `api/docs/api-response-envelope-comparison.md`,
  `api/docs/response-contracts.md` where they show these fields; the api-design-backlog gains the
  `/versions` note on public version identifiers if it does not already hold it.
- **Data integrity:** none. Response and parameter shape only; nothing stored changes.
- **Clients:** none outside the team. A script using `?publication_type=` would get a 400 naming the
  parameter (strict query-param handling), not a silently unfiltered list.
