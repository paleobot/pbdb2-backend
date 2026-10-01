## 1. Plain-column link targets

- [x] 1.1 In `src/lib/resource-tables.js`, extend `LinkTarget` so a target declares its label source: a JSONB key within a payload column, or a plain column. Keep the existing `references` / `authorities` entries behaving identically
- [x] 1.2 Register `taxa` as a link target (backing table `taxa`, plain-column label `name`), replacing the test-local fixture in `test/link-enrichment.test.js` that currently invents a non-existent `taxon` payload column
- [x] 1.3 In `src/lib/repository.js`, make `linkProjections()` emit `r.<column>` for a column-labelled target and the existing `r.<payload>->><key>` for a payload-labelled one; the emitted object shape is identical either way
- [x] 1.4 Assert the pre-existing `references` / `authorities` projections are byte-for-byte unchanged — the existing `PRE_REFACTOR_SQL` fixtures are the regression contract

## 2. Classification path decoding

- [x] 2.1 Add a single exported function that decodes an ltree `classification_path` into an ordered array of ancestor permids. This is the only place path encoding is understood, so a backend reshape (schema §9.7.4) is a one-file swap
- [x] 2.2 Round-trip labels with `replace(label, '_', '-')` — ltree labels cannot contain `-`, and UUIDs contain no `_`, so the substitution is lossless
- [x] 2.3 Drop the final element: it names the taxon's own *concept*, not an ancestor, and for the 30.7% of rows where `concept_permid <> permid` it is a different resource. Ancestors are elements `[0 .. n-2]`
- [x] 2.4 Return an empty chain for a root (single-element path), and handle a null path defensively
- [x] 2.5 Document the recursive-CTE fallback and that it would need its own iteration guard; the path approach needs none

## 3. Taxa repository

- [x] 3.1 Add `src/lib/taxa-repository.js`: a read module for a table with no JSONB payload and no version chain, following the `schema-tree.js` precedent rather than extending the generic engine
- [x] 3.2 Select the typed columns directly; apply NO version-chain predicate and NO `removed` predicate (`rebuild_taxa()` never writes `removed` and hard-deletes orphans — see `design.md`). Never select internal serial ids or the `winning_*_opinion_id` columns
- [x] 3.3 Join the dictionaries for `rank` and `nomenclaturalStatus` text values. These live in the `dictionaries` PostgreSQL schema, so their names are schema-qualified — `bareIdent()` in `repository.js` rejects the dot and must admit a qualified name, or the join must be written without passing through it
- [x] 3.4 Resolve `authority` (id-keyed → `authorities`) and `accepted` (permid-keyed → `taxa`) by REUSING the shared `linkProjections()` with the taxa qualifier, not by hand-written SQL
- [x] 3.5 Implement the single read: one row by `permid`, 404 when absent
- [x] 3.6 Implement the list read accepting the same page criteria as `readHeads` — `ids`, `limit`, `cursor` — ordered by `permid`, returning `{ records, hasMore }` so the shared list handler and `pageLinks` work unchanged
- [x] 3.7 Resolve the containing-taxa chain: decode the path, fetch all ancestors in ONE `WHERE concept_permid = ANY($1)` query, and nest them root-ward. Do not query per level
- [x] 3.8 For a list with the chain requested, pool the ancestor fetch across the whole page — the distinct ancestors are ~12.7× fewer than the entries (measured, §6)

## 4. Read-only resource shape

- [x] 4.1 In `src/lib/crud-routes.js`, add a read-only option that registers the GET routes and answers POST/PUT/PATCH/DELETE with 405 plus an `Allow` header
- [x] 4.2 Do NOT attach the `authenticate` preHandler to a read-only group's write verbs: the method is refused regardless of identity, so a 405 must never present as an auth failure
- [x] 4.3 Confirm the 405 body uses the standard error shape from `@fastify/sensible`, consistent with 400/404 elsewhere
- [x] 4.4 Verify the five existing CRUD groups are untouched by the new option's introduction

## 5. The containing-taxa opt-in

- [x] 5.1 Add a way for a resource to declare expansion parameters on its descriptor, alongside `filters`, so the seam knows `includeContainingTaxa` is recognized for `taxa` and unrecognized elsewhere
- [x] 5.2 In `src/lib/list-filters.js`, parse the boolean: exactly `true` or `false`; any other value — including the parameter present with no value — is a 400
- [x] 5.3 Allow it alongside `ids` (unlike `limit`/`cursor`, which `ids` rejects). A multi-entity read is a list and carries list semantics
- [x] 5.4 Single reads always carry the chain; no parameter suppresses it

## 6. Strict query-param handling

- [x] 6.1 In `collectListFilters`, compute the recognized set — universal (`ids`, `limit`, `cursor`) plus the resource's declared filters plus its declared expansions — and reject any other parameter with a 400 naming it
- [x] 6.2 Extend the same check to single reads, which today never inspect `request.query`. Without this, unknown params are rejected on lists and ignored on singles
- [x] 6.3 Leave field-filter VALUES opaque — a well-formed value matching nothing still yields an empty 200, not an error. Only unrecognized parameter NAMES become errors
- [x] 6.4 Add no `_`-prefix escape hatch for pass-through params; loosening later is non-breaking
- [x] 6.5 Confirm no existing test sends an undeclared parameter, and that stub-backed resources (`specimens`) recognize the universal params

## 7. Taxa routes

- [x] 7.1 Add `src/routes/api/v1/taxa/index.js` registering the group as read-only, with `meta.type` = `taxon` (singular, matching `reference`/`authority`/`collection`/`schema`/`specimen`)
- [x] 7.2 Route the list through the shared `listReadHandler` so `ids` and pagination behave identically to every other group
- [x] 7.3 Hydrate link hrefs via `hydrateLinkHrefs` for `authority` and `accepted`, and hydrate the chain's `href`s at the same boundary — the persistence layer stays HTTP-agnostic
- [x] 7.4 Confirm `taxa` appears automatically in the `/api/v1` discovery document (links are derived from the route tree, so this should need no discovery change) and add a test asserting it
- [x] 7.5 Confirm the route degrades to a clear failure, not a 500, when no DB is configured — taxa has no stub

## 8. Tests

- [x] 8.1 Unit-test the path decoder: multi-level path, root, null path, the underscore round-trip, and that the taxon's own concept is excluded
- [x] 8.2 Unit-test the taxa repository against a fake pg, asserting the emitted SQL has NO `succeeded_by_id` and NO `removed` predicate, and selects no internal ids
- [x] 8.3 Route tests via `app.inject()`: single read shape, 404, list default page, chain present on single, chain absent on list by default, chain present with the opt-in, opt-in alongside `ids`
- [x] 8.4 405 tests for all four write verbs on both the list and item paths, asserting the `Allow` header and that unauthenticated requests get 405 rather than an auth error
- [x] 8.5 Strict-param tests: unknown param 400 on a list, unknown param 400 on a single read, declared params still accepted, opaque filter value still 200-with-empty
- [x] 8.6 Non-boolean `includeContainingTaxa` values 400, including the bare parameter
- [x] 8.7 Integration tests against real PostgreSQL: a deep taxon's chain matches the adjacency walk, a root taxon has a null chain, a taxon whose concept differs from its permid excludes itself from its own chain, and `accepted` resolves to a different taxon
- [x] 8.8 Confirm the full existing suite passes untouched — any test needing an edit signals moved behavior, except those asserting the now-reversed lenient-param requirement

## 9. Documentation

- [x] 9.1 Update `docs/taxa-classification-reads.md` §1 to point at this change's `design.md` as the decisions record, now that it exists
- [x] 9.2 Note in that doc that `removed` is confirmed dead on `taxa`, with the `rebuild_taxa()` evidence — it is a measured finding and belongs beside the others
- [x] 9.3 Update `CLAUDE.md`: six route groups, `taxa` read-only, and strict query-param handling
