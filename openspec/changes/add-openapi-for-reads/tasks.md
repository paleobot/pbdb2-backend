## 1. Payload schemas (`payloadSchemas/`)

- [ ] 1.1 `lib/ajv.js`: `createAjv(options = {})` merges `options` over the defaults; no-argument
      behavior unchanged. Test: `createAjv({ coerceTypes: true })` accepts `"5"` as an integer and
      `createAjv()` rejects it; both are strict and know the annotation keywords
- [ ] 1.2 `lib/variants.js`: a source with root `readOnly: true` makes `deriveVariant` throw for
      `in-create` and `patch-guard`, naming it read-only; `db` and `out` derive as usual. Test in
      `tests/variants.test.js`
- [ ] 1.3 New `taxon.schema.js` exporting `taxonSource` (and `default`) per the "taxon source"
      requirement: root `readOnly: true`, every property `x-storage` (a `taxa` column), `rank` /
      `nomenclaturalStatus` with `x-enumFrom` (`taxonomy_ranks.taxonomy_rank`,
      `nomenclatural_statuses.status`; status nullable), `authority` and `accepted` via `link()`
- [ ] 1.4 `tests/sources.test.js`: add `taxon` to the module-export check and the draft check;
      the strict-compile loop derives only `db` and `out` for a read-only source; `db` of taxon has
      no properties; check against the localhost dictionaries that the two `x-enumFrom` pairs
      resolve (`dictionary-seeds` / enums tests, if they enumerate pairs)
- [ ] 1.5 Reword the `additionalReferences` descriptions in `collection.schema.js` and
      `schema.schema.js` so they no longer name `additional_collection_refs` /
      `additional_schema_refs`

## 2. Query validation (`api/`)

- [ ] 2.1 New `src/lib/query-schemas.js`: build each GET route's querystring schema from the
      descriptor (universal `ids` / `limit` / `cursor` with descriptions stating the cross-parameter
      and in-code rules, field filters with `minLength: 1` and the source's inline enum,
      expansions as booleans, `dependentSchemas` for `ids` vs `limit`/`cursor`,
      `additionalProperties: false`, no `default`s); single reads accept only declared single-read
      parameters
- [ ] 2.2 `src/app.js`: `setValidatorCompiler` using `createAjv({ coerceTypes: true,
      removeAdditional: false, useDefaults: false })` for querystring and params (a non-coercing
      `createAjv()` for any other part); a `preValidation` hook trims every query value, rejects a
      repeated parameter, and requires a bare digit string for integer-typed parameters
- [ ] 2.3 Schema error formatter mapping Ajv errors to today's exact messages (D11 list), returned as
      `httpErrors.badRequest`, so the standard error shape and `BadRequestError` name are unchanged
- [ ] 2.4 Attach the querystring (and `params`) schemas to every GET route: the uniform groups via
      `crud-routes.js`, `schemas`, `taxa`, and the discovery routes (no parameters)
- [ ] 2.5 Shrink `collectListFilters` / `rejectUnknownQuery` to what the schema cannot express
      (cursor decoding, the 100-distinct-ids cap after split/trim/dedupe, the default `limit`),
      so each rule lives in one place; update its doc comments
- [ ] 2.6 Tests: every existing message assertion passes unchanged; new cases for a trimmed enum
      value, `limit=1e3` / `0x10` / `1.0`, a repeated parameter, and two unknown parameters named
      in one message

## 3. Response schemas (`api/`)

- [ ] 3.1 New `src/lib/published-schemas.js`: from a source's `out` variant, strip `$schema`, `$id`,
      `x-storage`, `x-enumFrom`, `codec`, `x-variant`; turn each `x-enumFrom` property into a string
      whose description names its vocabulary in words; replace each `x-link` node with a `$ref` to
      a generated `<Target>Link` component (nullable where `out` allows), throwing on one target
      with two labels; produce the named components `Collection`, `Reference`, `Authority`,
      `Schema` (with `characters`), `Character`, `State`, `Taxon` (with optional
      `containingTaxa`), `ContainingTaxon`; leave no `x-` keyword
- [ ] 3.2 `src/plugins/envelope.js`: envelope schemas for a single resource (`meta` = `{ type }`,
      `links` = `{ self }`), a list (`meta` with `returned`, `type`, optional `requested` /
      `missing`; `links` with `self`, `next`, `prev`) and an index document
- [ ] 3.3 `src/app.js`: `setSerializerCompiler(() => JSON.stringify)`; register the published
      components with `addSchema` before routes load
- [ ] 3.4 Attach `response: { 200: … }` to every documented GET route (single and list for
      `authorities`, `collections`, `references`, `schemas`, `taxa`; the three index routes)
- [ ] 3.5 Conformance tests validate against the **published** schemas: switch
      `test/source-reads.test.js` (including `assertSchemaTreeContract`, now one validation
      against `Schema`), add taxa single/list (with and without `includeContainingTaxa`) in
      `test/taxa.test.js`, and validate the integration suite's reads the same way
- [ ] 3.6 Test that a field the response schema does not declare reaches the body unchanged

## 4. The description (`api/`)

- [ ] 4.1 Add `@fastify/swagger` and `@fastify/swagger-ui` to `api/package.json` (exact versions
      installed at the root lock file), and `@seriousme/openapi-schema-validator` as a dev
      dependency
- [ ] 4.2 New plugin registering `@fastify/swagger` (OpenAPI 3.1.0, `info` from the `/api/v1`
      node, `refResolver.buildLocalReference` naming components by `$id`) and `@fastify/swagger-ui`
      at `/api/v1/docs`; a hidden `GET /api/v1/openapi.json` returning `app.swagger()`
- [ ] 4.3 Hide from the document: the stub write routes in `crud-routes.js` and `schemas`,
      `taxa`'s 405 routes, every `specimens` route (D12)
- [ ] 4.4 `src/plugins/discovery.js`: ignore hidden routes when deriving children (a segment counts
      when any non-hidden route lies under it); `/api/v1` adds `describedby` and `docs`
- [ ] 4.5 Tests: the document validates as OpenAPI 3.1; its GET paths equal the paths discovery
      reaches (single reads included); no write operation and no `specimens` path; no `x-` key,
      `dictionaries.` name or child-table name; `references` lists `publicationType` with the enum
      and `limit` 1..1000; `Collection.primaryReference` is `ReferenceLink` or null; `/api/v1`
      discovery has `describedby`/`docs` and no `specimens`; `/api/v1/docs` serves HTML;
      `openapi.json` is not enveloped. Update `test/discovery.test.js` for the specimens removal

## 5. Docs

- [ ] 5.1 `api/CLAUDE.md`: layout (new libs and plugin), key patterns (route schemas validate
      queries and document responses; `JSON.stringify` serialization; hidden routes; where the
      description lives), and remove "Swagger generation" from Deferred
- [ ] 5.2 `docs/api-design-backlog.md`: add the dictionaries read resource (D5, with its trigger),
      the property-descriptions follow-up (D9), and note on "Serving the schemas to clients" that
      the published components now partly serve it
- [ ] 5.3 `api/docs/response-contracts.md`: note that the response contract is now published
      (`/api/v1/openapi.json`) and how links appear in it

## 6. Verify

- [ ] 6.1 `npm test` and `npm run test:integration` pass
- [ ] 6.2 Against localhost: `/api/v1/openapi.json` validates as OpenAPI 3.1; `/api/v1/docs` renders
      and "Try it out" runs `GET /api/v1/references?publicationType=standalone%20book&limit=2`;
      real single and list responses of every documented resource validate against the published
      schemas; `/api/v1` shows `describedby` and `docs` and no `specimens`
- [ ] 6.3 `openspec validate add-openapi-for-reads` passes
