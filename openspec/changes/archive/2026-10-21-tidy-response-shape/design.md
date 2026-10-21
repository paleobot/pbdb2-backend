## Context

`add-openapi-for-reads` will publish the GET contract. In its explore session (2026-10-21) three
parts of today's shape were traced back to the changes that introduced them. Each was deliberate
when made; each has since become redundant or impossible to fill:

- `meta.found`: `add-pagination` kept counts page-scoped (no `COUNT(*)` per request over 517k rows)
  and recorded an opt-in `?count=true` as the follow-up. As a result `sendList`
  (`api/src/plugins/envelope.js:46`) sets `found` and `returned` to the same `data.length`. The
  `ids` read adds `requested` and `missing` (`api/src/lib/crud-routes.js`), and drops them when a
  field filter is also given.
- `publication_type`: `add-field-filters` named the first filter in snake_case and recorded the
  param → `jsonPath` translation in the descriptor (`api/src/lib/resource-tables.js`).
  `add-taxa-reads` later named its expansion `includeContainingTaxa`, in camelCase, because it
  derives from the field name. Every response field is camelCase.
- `meta.removed` / `meta.version`: `sendData` writes `removed: false` and
  `version: { supersedes: null, supersededBy: null }` on every single read, the stub write
  responses and taxa included, because `api-foundation` reserves them "even when their values are
  placeholders". The comment gives the reason, a stable shape "before DB integration", which has
  since landed.

No client outside the team consumes the API.

## Goals / Non-Goals

**Goals:**
- Every field in the response shape carries information, and every name follows one convention,
  before the shape is published.
- Specs and docs say the same as the code.

**Non-Goals:**
- A total count (`?count=true`) and the `/versions` sub-resource. Both stay recorded follow-ups;
  this change only stops publishing their placeholders.
- Any change to what records a request returns, to ordering, pagination or cursors.
- Deprecation aliases for removed names (D4).

## Decisions

### D1. Lists drop `meta.found`; `meta.returned` is the count

List `meta` becomes `{ type, returned }`. A pure `ids` read adds `requested` and `missing`, as today.
`returned` stays rather than `found` because it says exactly what it is: the number of records in
this page. When `?count=true` is built, the total arrives under its own name and means "all
matching", so no field changes meaning.

*Alternatives:* keep both fields, documented as equal (publishes a redundant field whose name
suggests a total); keep `found` and drop `returned` (`found` is the name that misleads).

### D2. A field filter's parameter is the name of the field it matches

`?publication_type=` becomes `?publicationType=`. The descriptor's filter key is the field name; its
`jsonPath` stays, equal to the key for a top-level field, because it is where a nested path would go
if a later filter needs one. Nothing else about filters changes: exact match after trimming, enum
values from the source, empty value → 400, AND with `ids`.

*Why camelCase, and why the field name:* it is the rule `add-taxa-reads` used for
`includeContainingTaxa`, so params, expansions and fields share one vocabulary, and a reader of the
published document never has to translate between two. `ids`, `limit` and `cursor` are single words
and unaffected.

*Alternative:* snake_case for every parameter (rename `includeContainingTaxa` instead). Rejected: it
keeps a translation between parameter and field for every filter, which is what this removes.

### D3. Single reads drop `meta.removed` and `meta.version`; `meta` is `{ type }`

Neither can carry information under the current design:
- a GET serves only a current, non-removed head (anything else is a 404), so `removed` is always
  `false` and `supersededBy` is always `null`;
- versions share their lineage's `permid` (`db/02-core.sql`: "constant regardless of succession
  version"), and the only identifier of a previous version is `preceded_by_id`, an internal id the
  API must never expose, so `supersedes` has nothing to hold;
- `taxa` has no version chain and its `removed` column is dead (`api/src/lib/taxa-repository.js`).

They return with real values alongside `/versions`, which must also decide what a public version
identifier is. The stub write responses (POST/PUT/PATCH, also through `sendData`) lose them too.

**The same requirement's other reservation goes as well.** `api-foundation` also reserves "`links`
relationship entries even when their values are placeholders". The code never wrote any (`links` on
a single read is `{ self }`), and relationships are inline links in `data` since
`api/docs/response-contracts.md` decision A. The clause is removed, so the requirement states what
the envelope does.

*Alternative:* keep the fields, documented as reserved. Rejected: under OpenAPI they would be
promised, and removing them after clients exist is breaking. The "stable shape" reason protects
clients there are not yet.

### D4. No aliases, no deprecation period

With no outside clients, an alias would only add a second name to document and later remove. A
stale `?publication_type=` gets a 400 naming it and listing `publicationType` among the accepted
parameters (strict query-param handling), never a silently unfiltered list. A client reading
`meta.found` gets `undefined`, which this change accepts for the same reason.

### D5. Docs are corrected where they show the old shape

`api/docs/api-response-envelope-comparison.md` §2 shows `"found": 1240` beside `"returned": 100`
(implying a total) and a populated `meta.version` with relationship entries in `links`. Its examples
are corrected to the current shape, with a sentence noting that relationships moved inline (decision
A) and that version fields await `/versions`. The comparison with `data1.2` itself is history and
stays. `api/CLAUDE.md` and `api/docs/response-contracts.md` are updated where they name these
fields.

## Risks / Trade-offs

- [An unknown script relies on `publication_type` or `meta.found`] → there are no known outside
  consumers. A stale filter fails loudly with a 400 naming the parameter; only a stale `found` read
  fails quietly, and nothing in this repo reads it outside tests.
- [Removing `meta.version` now, re-adding it with `/versions`] → re-adding a field is non-breaking
  for clients; shipping a placeholder and later changing its meaning would not be.
- [Test churn hides a behavior change] → the assertions that change only name fields
  (`meta.found` → `meta.returned`, the filter name, the absent `meta` keys). The ids and filter
  semantics tests (multi-get, field-filters, pagination) keep their record expectations unchanged.

## Migration Plan

Code, specs and docs change together in one commit; nothing is stored or migrated. Rollback is
reverting that commit. The integration suite (`npm run test:integration`) runs before committing,
since it asserts on real responses.

## Open Questions

None.
