## Why

A client exploring the API cannot find out what a resource accepts or what it returns. The
`/api/v1` index lists resource names only. A list endpoint's filters show up only in the 400 a wrong
guess produces. Nothing describes a response's shape, though each version-chained resource's `out`
variant already describes it exactly (`test/source-reads.test.js` checks this). That knowledge exists
in code (descriptor `filters`/`expansions`, the `out` variants, the envelope) but is published
nowhere. `api/docs/response-contracts.md` §1 deferred serving the variants while reads did not follow
`out`; since `schema-reads-from-payload-schemas` (dfbf84b) every version-chained resource does, so
the variants now describe the contract the API keeps.

## What Changes

- Every GET route declares a Fastify route schema: a `querystring` schema built from the resource's
  descriptor (universal params, field filters, expansions), and a `response` schema of the envelope
  with `data` described by the source's `out` variant.
- The querystring schema is **enforced** by Fastify's validator, configured so that it rejects
  rather than strips unknown parameters, reports every error, and does not apply defaults before
  cross-parameter rules. A central error formatter keeps today's 400 messages and the standard error
  shape. The rules JSON Schema cannot express (cursor decodability, the distinct-id count) stay in
  `collectListFilters`.
- The response schema **documents** and does not reshape: responses are serialized with
  `JSON.stringify`, not with fast-json-stringify. Conformance is enforced by tests that validate real
  responses against `out`.
- An OpenAPI 3.1 document generated from the route schemas is served, with internal storage
  annotations (`x-storage`, `x-enumFrom`, codecs) stripped.
- The discovery documents point at it (`describedby`).
- Scope is GET only. The stub write routes, `taxa`'s 405s and `specimens` (a stub) are hidden from
  the document, which describes only what a client can rely on. Request bodies for writes come
  later, from the `in-create` and `patch-guard` variants.

## Capabilities

### New Capabilities

- `api-description`: the served OpenAPI document. What it covers, that it is generated from the
  route schemas rather than written by hand, what it strips, and where it is served.

### Modified Capabilities

- `api-discovery`: `/api/v1` links the description (`describedby`, `docs`); routes hidden from the
  description are not listed, so `specimens` leaves the index while it is a stub.
- `api-foundation`: the envelope requirement names the description routes (a raw OpenAPI document,
  an HTML viewer) as exceptions.
- `resource-routes`: query parameters are validated against a declared querystring schema. The
  observable behavior (strict 400s naming the parameters, enum values listed in order, the standard
  error shape) is preserved; requirements change only if the messages do.
- `payload-schema-variants`: a source may be read-only (root `readOnly: true`), and `deriveVariant`
  refuses its `in-create` and `patch-guard` variants (the first such source is `taxon`).
  `createAjv()` takes options, so the API can add querystring coercion.

Prerequisites: `tidy-response-shape` (response shape) and `adopt-json-schema-2020-12` (draft) land
first.

## Impact

- **Code (`api/`):** `src/app.js` (validator and serializer compilers, error formatting),
  `src/lib/crud-routes.js` and the `schemas` and `taxa` route groups (route schemas),
  `src/lib/list-filters.js` (shrinks to the rules schema cannot express),
  `src/plugins/envelope.js` (an envelope schema), `src/plugins/discovery.js` (`describedby`), and a
  new route or plugin serving the document.
- **Code (`payloadSchemas/`):** new `taxon.schema.js` (read-only source); `lib/variants.js`
  (read-only handling); `tests/sources.test.js`.
- **Dependencies:** likely `@fastify/swagger` and a viewer. `ajv` is already a root dependency.
- **Tests:** a test that the generated document is valid OpenAPI 3.1 and covers every route that
  discovery lists; response conformance tests for every resource with a response schema.
- **Data integrity:** none. Read path only, nothing stored. The one risk is a serializer that
  silently drops or coerces fields, which is why responses are not serialized through the schema
  (design.md D2).
