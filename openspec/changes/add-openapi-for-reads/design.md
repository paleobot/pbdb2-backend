## Context

An explore session on 2026-10-20 and 2026-10-21 walked the running API as a new client would. The
gaps: `/api/v1` lists resource names only; a list's filters appear only in the 400 a wrong guess
produces (`?bogus=1` → "accepts `ids`, `limit`, `cursor`, `publication_type`"); nothing describes a
response's shape; `OPTIONS` is a 404. The user's priority: knowing the **filters** and the
**response shapes**.

No route declares a Fastify `schema` today. Query validation is all hand-written in
`collectListFilters` (`src/lib/list-filters.js`). Response shapes are described by each source's
`out` variant (`payloadSchemas/lib/variants.js`), which `test/source-reads.test.js` validates real
responses against, using the payload schemas' own `createAjv()` (`strictRequired: false`).

Both prerequisites have landed (2026-10-21): `tidy-response-shape` (`c13a22b`: no `meta.found`, no
`meta.removed`/`meta.version`, the filter is `publicationType`) and `adopt-json-schema-2020-12`
(`e16d318`: every schema and `createAjv()` are draft 2020-12, OpenAPI 3.1's dialect). Fastify's own
default Ajv is still draft-07, which D7 replaces.

## Goals / Non-Goals

**Goals:**
- A client can learn every GET route's query parameters and response shape from the API itself.
- What is documented is what is enforced (querystring) or tested (response). Nothing is written by
  hand twice.

**Non-Goals:**
- Request bodies and write routes (later, from `in-create` / `patch-guard`).
- HAL, JSON:API or any envelope change; `OPTIONS` bodies.
- Serving the derived variants as standalone JSON Schema routes (the "Serving the schemas to
  clients" backlog entry). The OpenAPI document's `components/schemas` may later serve that need.

## Decisions

### D1. Querystrings: Fastify's validator enforces the declared schema (option B)

Each GET route declares `schema.querystring`, built from the descriptor (universal params, field
filters with their enums, expansions). Fastify validates it. A central formatter turns validation
errors into today's messages in the standard `{ error: { statusCode, error, message } }` shape. What
JSON Schema cannot express stays in `collectListFilters`: **cursor decodability** and **at most 100
distinct ids** in a comma-separated string. Defaults (`limit` → 100) are applied there too (below).

The validator must be configured. Evidence from probes against the installed Fastify:
- **`removeAdditional` must be off.** Fastify's default (`removeAdditional: true`) turns
  `additionalProperties: false` into silent stripping: `?bogus=1` became a 200 for the full list,
  which breaks "Strict query-param handling" (resource-routes).
- **`useDefaults` must not run before cross-param rules.** With `limit: { default: 100 }` in the
  schema, every `ids` request looked like "ids + limit" and was rejected. Keep `default` out of the
  querystring schema, or out of any field a cross-param rule reads.
- **`allErrors: true`.** The spec says the 400 names "the unrecognized parameter or parameters". By
  default Ajv stops at the first error.
- The specs pin meaning, not wording: "names the parameter", and for enums "lists the legal values
  in enum order". The formatter reads `err.validation`
  (`params.additionalProperty`, `params.allowedValues`) and lists accepted params from the schema's
  `properties`.

*Alternatives:* (A) document-only querystring schemas, with the hand check unchanged and both built
from one parameter list. This keeps today's messages for free but runs a parallel validator beside
Fastify's: "a better wheel, but reinventing it." (C) both enforcing: overlapping rules, mixed
messages. Rejected.

### D2. Responses: the schema documents, it does not reshape (option b)

Each GET route declares `schema.response` (the envelope, with `data` from the `out` variant), so
documentation tooling sees it. Serialization uses `JSON.stringify`
(`app.setSerializerCompiler(() => JSON.stringify)`), not fast-json-stringify. The contract is
enforced by Ajv tests against `out`, as `source-reads.test.js` does today. An `onSend` validation
hook in development and tests only is optional.

*Why:* fast-json-stringify is a serializer, not a validator. Probe results: an undeclared field is
**dropped**, `"12"` becomes `12`, an object in a string field becomes `"[object Object]"`, a `null`
in a string field becomes `""`, `enum` and `maxLength` are ignored, and a missing `required` field
or an unconvertible integer makes the **whole page a 500**. Real data passed unchanged (200 rows
each of collections, references and authorities: 0 differences), so the risk is future drift
between a source and its responses, which would show up as wrong 200s. That contradicts the
project's no-silent-failure stance (strict params, no `limit` clamp). The speed fast-json-stringify
gives is irrelevant beside the database at 100–1000 rows per page.

*Consequence:* a route's response schema has no runtime effect, so only a test can catch it being
wrong. Every resource with a response schema needs a conformance test.

*Alternatives:* (a) Fastify's default, serializing through the schema: rejected for the above. (c)
Ajv validation of every production response, a mismatch answering 500: possible later; for now it
runs only in development and tests.

### D3. Storage annotations are stripped from the published description

The `out` variants carry `x-storage`, `x-enumFrom` (table and column names), `codec` and `x-variant`.
They describe storage, not the contract, and the agreed boundary is that the storage layer does not
leak into the API (response-contracts.md §2). They are removed when building the published
document. `x-link` is open (below): it says what a link points to, which is contract information.

### D4. Responses with no `out` variant of their own

- **Schema tree (`/schemas/:permid`): composed from the variants.** The schema, character and state
  `out` variants are nested by copying `properties` and adding the child arrays as recursive `$ref`s
  under `$defs`. All field content comes from the variants; only the nesting is written, once, in
  `api/` beside `schema-tree.js`, where the tree is built (data-access D7). `allOf` does not work:
  every variant is closed with `unevaluatedProperties: false`, and probing showed
  `allOf: [schemaOut]` rejecting `characters` as unevaluated. Probe: the composed schema validated a
  real 299-node schema and rejected a stray field four levels down. `assertSchemaTreeContract`
  (`test/source-reads.test.js`) becomes one validation against the published schema instead of a
  check node by node.
- **Taxa: a payload source, `payloadSchemas/taxon.schema.js`.** DESIGN_NOTES.md defines a source as
  the entity "as the API sees it", one per resource, and nothing in that requires a jsonb column:
  every taxon property is `x-storage` (a column), the extreme case of what every source already does
  for `permid`. `authority` and `accepted` are ordinary `link()`s with the target's own field as label
  (`citation`, `name`). `rank` and `nomenclaturalStatus` take `x-enumFrom` from
  `dictionaries.taxonomy_ranks` and `dictionaries.nomenclatural_statuses`, so they get the same enum
  treatment as every other dictionary field. The source is marked with the standard root-level
  `readOnly: true`, and `deriveVariant` refuses `in-create` and `patch-guard` for a read-only source
  (`db` derives to an empty object, which is accurate: nothing is at rest). Taxa reads stay on
  `taxa-repository.js`, which is tuned for classification paths, so the source's `x-storage` is
  descriptive, not executed. The taxa conformance tests, unit and integration, are what keep it
  true. `containingTaxa` (an expansion, a recursive chain) is composed in `api/` from the taxon `out`
  variant, as the schema tree is.
- **Envelope: its schema is written in `plugins/envelope.js`**, beside the three functions that
  produce `{ data, meta, links }`, which the file already calls the single source of truth. Every
  route's response schema wraps its `data` schema in it.
- **Specimens: left out of the document.** The route serves stub data though the table exists, and
  a documented stub is a false contract. The document-coverage test exempts it, saying why, until its
  reads are real.

*Alternatives for taxa:* a schema written by hand in `api/` (cheap, guarded by the same tests, but a
second mechanism for one resource and no dictionary enums); generating it from `03-taxa.sql` column
types (rejected: the response is not the columns, so a mapping layer would be needed anyway). For the
read-only marker, an `x-` keyword was considered so that `readOnly` would not have two meanings at
different depths (property level: strip from `in-create`; root: no write variants). The standard
keyword was chosen because tools already understand it.

### D5. Enums: inline ones published; dictionary ones named, not listed

Inline enums (`publicationType`, closed sets that code depends on) go into the document as `enum`.
They are facts in code and true in every deployment. A dictionary-backed property (`x-enumFrom`) is
documented as `type: string`, with a description naming its vocabulary in words and saying curators
may add values. The table name is not published (D3).

*Why:* the `out` variant drops dictionary enums on purpose (payload-schema-variants: a stored value
may no longer be in its dictionary, and the response is still valid), so publishing `enum` would
contradict the response contract. Resolving values at startup would make the document depend on the
database: `npm test` builds without one, so the coverage test would check a different document than
a deployment serves, and the document would be stale whenever a curator added a value. Size matters
too: `admin1` has 3,865 values on localhost.

*Alternatives:* resolve into `enum` (false, as above); resolve into non-binding `examples` (honest,
but has the DB dependency and the size problem); a dictionaries read resource
(`/api/v1/dictionaries/{name}`) linked from each field. **Deferred to the api-design-backlog**,
triggered by the first dictionary-backed GET filter (likely `?rank=` on taxa, whose 400 must then
list live values) or the frontend's first dropdown. Runtime enum resolution lands with it.

### D6. The shape is tidied first, in `tidy-response-shape`

Three parts of the response shape would be published as promises they cannot keep: `meta.found`
(always equals `returned`), the snake_case filter `publication_type` (every field and the expansion
`includeContainingTaxa` are camelCase), and `meta.removed`/`meta.version` (constant by construction
on a head read; no public version identifier exists). `tidy-response-shape` drops `found`, renames
filters to their field names, and drops the two placeholders, and **it lands before this change**.
This change documents the shape as it is after that. Its rationale is in that change's proposal.
`adopt-json-schema-2020-12` (D7) also lands first.

### D7. Fastify's validator is `createAjv(options)`, coercing querystrings only

Fastify's default Ajv is draft-07, which lacks `unevaluatedProperties` and `dependentSchemas`.
`setValidatorCompiler` replaces it with the backend's own factory, so the annotation keywords and
strict mode are registered in one place. `createAjv()` gains an options argument (a
`payload-schema-variants` change): querystrings and params get
`{ coerceTypes: true, removeAdditional: false, useDefaults: false }` (D1), since every query value
arrives as a string. `coerceTypes: true`, not `'array'`: a repeated parameter (`limit=5&limit=6`)
arrives as an array and must be a 400, not unwrapped (D11). Request bodies, when writes come, get an instance with **no** coercion: Fastify's
default `coerceTypes` applies to bodies too and would turn a body's `"12"` into `12`, hiding a client
bug. The compiler picks the instance by the `httpPart` it is given.

Draft: settled by `adopt-json-schema-2020-12` (landed): the whole backend is 2020-12, so the
draft tests run under is the draft the document publishes.

### D8. `@fastify/swagger` generates the document; Swagger UI shows it

Probed with `@fastify/swagger` 9.9.2 on routes built per D1/D2/D4/D7 (2026-10-21):
- The querystring schema becomes OpenAPI `parameters` with names, bounds, enums and descriptions.
- **Cross-parameter rules are lost** (`dependentSchemas` dropped): OpenAPI lists parameters one at a
  time. Ajv still enforces them (D1). The document states them in each parameter's `description`,
  as it does the rules that live in code (the 100-id cap, cursor opacity).
- **Amends D4:** the schema tree's nodes are registered shared schemas (`app.addSchema` with
  `$id: 'Character'` / `'State'`, referenced as `'Character#'`), not `$defs` inside the response
  schema. Embedded in the document, `#` resolves to the document root, so `#/$defs/character`
  pointed nowhere and the document was invalid. As shared schemas they become
  `components.schemas`, the document validates as OpenAPI 3.1
  (`@seriousme/openapi-schema-validator`), and the real 299-node tree still validates.
- `refResolver.buildLocalReference` names components by `$id` (`State`, `Character`), not `def-0`.

Viewer: **`@fastify/swagger-ui`** (2.6 MB, maintained by the Fastify org, "Try it out" runs GETs from
the page). Alternatives: Scalar (`@scalar/fastify-api-reference`, 9.6 MB, third-party, fast release
cycle); Redoc (read-only); none (import into Postman). Changing the viewer later is one line,
because the document is the asset.

Paths, under the version because each version has its own contract:
- `/api/v1/openapi.json`, the canonical document (the `describedby` target);
- `/api/v1/docs`, the viewer, which also serves the document at `/api/v1/docs/json`, a harmless
  alias. The viewer's own routes are kept out of the document automatically.

Spec consequences:
- `api-foundation` requires the envelope on every successful response. The description routes (a
  raw OpenAPI document, an HTML page) need a named exception.
- `api-discovery` derives `/api/v1`'s children from the route table, so `docs` and `openapi.json`
  would be listed as resources. Discovery skips them, and the index links them by relation
  instead (Open Questions: discovery).

### D9. Links are named components; tests check what is published

None of this changes a response; it changes how the document presents a link. The step that builds
the document replaces each `x-link` node with a `$ref` to a generated component named for its
target (`ReferenceLink`, `AuthorityLink`, `TaxonLink`), keeping `null` where `out` allows it. The
component carries the link's fields and a one-sentence description naming the target and its URL
pattern. Components are generated from the `x-link` declarations, never written by hand; one target
declared with two different labels makes the generator throw. No `x-link` remains in the document.

*Why:* Swagger UI does not display unknown `x-` keys, so keeping `x-link` (or stripping it) leaves
the reader with an anonymous `{ permid, title, href }` and no indication of what it points at. A
named type shows in the viewer and can be clicked through to. Probe: the collection document with
`ReferenceLink` validates as OpenAPI 3.1, and 200 of 200 real collections validate against the
published `Collection` schema.

*Alternatives:* strip `x-link`; keep it raw (invisible in viewers); OpenAPI Link Objects (single
reads only, since runtime expressions cannot index into arrays; they need operationIds and render as
text). Link Objects could be added later on single reads.

**Amends D2: conformance tests validate against the published schemas** (after D3 stripping, D4 tree
components and D9 link components), not raw `out`, so the publishing step is itself tested.
`assertSchemaTreeContract` validates against the published `Schema`/`Character`/`State` components.

**Descriptions are published as written.** Two name tables (`collection.additionalReferences`,
`schema.additionalReferences`: "every additional_…_refs row") and are reworded in the sources by
this change. The `legacyIDs` descriptions ("migrated from old PBDB") stay; they are useful.
Coverage is thin: 62 descriptions across six sources for a few hundred properties. Writing them is
a **follow-up**, content work rather than mechanism.

### D10. Discovery links the description; hidden routes are not listed

`/api/v1` gains two links: `describedby` → `/api/v1/openapi.json` and `docs` → `/api/v1/docs`. They
appear only there, because the description belongs to a version; `/` and `/api` are unchanged (two
hops from the root, and "the current version" needs no definition while only v1 exists).

Discovery ignores every route marked `schema.hide` (the mark `@fastify/swagger-ui` already sets on
its own routes, and the one `@fastify/swagger` uses to leave a route out of the document). One rule:
**a route hidden from the documentation is also absent from discovery**. A path segment is listed
when any non-hidden route lies under it (D12), so `docs` and `openapi.json` are linked by relation,
not listed as resources. As a consequence, **`specimens`
leaves the `/api/v1` index** while it is a stub (D4), for D4's reason: listing it invites exploring
fake data. It returns when its reads are real. `api-discovery` changes accordingly (its scenario
lists specimens).

The index stays a list of links. Per-resource descriptions and parameter templates live in the
document, not repeated in the index. A per-response `describedby` (in `links` or an HTTP `Link`
header) is not added: noise on every response for what the index already provides.

*Alternatives:* a second, discovery-only flag that would keep specimens listed (two concepts for
one idea); the new links also at `/` (needs a notion of the current version).

### D11. Query values are normalized before validation; messages are kept

A probe of Ajv2020 with D7's options (2026-10-21) showed where plain coercion would loosen rules
that are deliberate today:
- `integer` coercion goes through `Number`, so `limit=1e3`, `0x10` and `1.0` were **accepted**
  (as 1000, 16, 1). `collectPage` rejects them on purpose ("a bare integer only").
- Enum matching is exact, so `publicationType=%20standalone%20book%20` was **rejected**, while
  `resource-routes` requires comparison "after trimming surrounding whitespace".
- An empty value passes a filter with no enum.

So a `preValidation` hook, which runs before Fastify validates, **trims every query value**, and
**requires a bare digit string for every parameter the schema types as `integer`**. The schema keeps
`limit` as `{ type: 'integer', minimum: 1, maximum: 1000 }`, which is what the document shows and Ajv
checks after coercion. Field filters carry `minLength: 1`; `ids` carries a non-blank `pattern`.

**One value per parameter:** a repeated parameter is a 400. Today `?ids=a&ids=b` happens to work
(`String(['a','b'])` is `"a,b"`); that is an accident, not a contract, and the document describes
one comma-separated value.

**Messages are unchanged.** The schema error formatter (Fastify's `schemaErrorFormatter`) maps each
Ajv error to the message the hand code gives today, returned as `httpErrors.badRequest`, so the
error shape and name (`BadRequestError`) are unchanged too:
- `additionalProperties` → "Unrecognized query parameter(s): `…`. This resource accepts `…`"
  (all unknown names, from `allErrors`; the accepted list from the schema's `properties`);
- `enum` → "`<param>` must be one of: <values in order>";
- `minLength` / blank `pattern` → "`<param>` must have a value"; for `ids`, "`ids` must contain at
  least one id";
- `type`/`minimum` on an integer, or the hook's bare-digit check → "`limit` must be a positive
  integer"; `maximum` → "`limit` accepts at most 1000";
- `type: boolean` → "`<param>` must be exactly `true` or `false`";
- the `ids` exclusivity rule (`dependentSchemas`) → "`ids` cannot be combined with `limit`/`cursor`:
  a multi-entity read is a single page", naming the parameters actually sent.

What stays in `collectListFilters`: cursor decoding, the 100-distinct-ids cap (after splitting,
trimming and de-duplicating), and the default `limit`. The existing tests that assert messages are
the guard that nothing changed.

### D12. Only real GET operations are documented

The document describes what a client can rely on. So these routes carry `schema.hide`:
- the stub write routes (POST/PUT/PATCH/DELETE on the uniform groups and `schemas`), which return
  fake data and do not touch the database;
- `taxa`'s 405 write routes;
- every `specimens` route (D4);
- the description's own routes (`openapi.json`, the viewer).

Discovery lists a path segment when **any** non-hidden route lies under it (D10). Hiding a write
route therefore does not remove its resource, whose GET is visible, and hiding every `specimens`
route removes `specimens`. The discovery routes themselves (`/`, `/api`, `/api/v1`) are documented,
as index documents. When writes become real, their routes are unhidden with request schemas from
`in-create` / `patch-guard`.

## Risks / Trade-offs

- [Response schema drifts from what is served, unnoticed at runtime] → conformance test per
  resource; optional dev/test `onSend` validation.
- [Formatter messages diverge from current wording] → specs pin meaning, not text; existing tests
  that assert messages stay as the guard.
- [Validation now split between Ajv and `collectListFilters`] → the split is by kind (shape vs.
  semantics), not overlapping; each rule lives in exactly one place.

## Open Questions

- **Revisit later (user, 2026-10-21):** a richer `/api/v1` index, with per-resource descriptions or
  URI templates, instead of links only (D10). Decided "for now".
- **Follow-up:** descriptions for the many properties that have none (D9).
- **Prerequisites:** `tidy-response-shape` and `adopt-json-schema-2020-12` land first (D6, D7).
