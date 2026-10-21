## Why

The payload schemas declare JSON Schema draft 2019-09. It was the minimum draft with
`unevaluatedProperties` (`payloadSchemas/lib/ajv.js`), never chosen over 2020-12, which has the same
keyword. `add-openapi-for-reads` will publish these schemas in an OpenAPI 3.1 document, whose dialect
is 2020-12: schemas would be tested as 2019-09 and published as 2020-12. That is harmless today,
because no keyword the schemas use differs between the drafts (`$recursiveRef`, array-form `items` and
the `format` vocabulary split are unused), but nothing checks it, and a later keyword that does
differ would open the gap silently. 2019-09 is also superseded. Moving the whole backend to 2020-12
now is mechanical, and the existing suites show whether anything changed. It lands before
`add-openapi-for-reads`, which then builds Fastify's validator from `createAjv()` with no draft
question left (explore session, 2026-10-21).

## What Changes

- Every payload source and `opinionAttribution.schema.js` declares
  `$schema: "https://json-schema.org/draft/2020-12/schema"`; derived variants inherit it.
- `createAjv()` returns an `ajv/dist/2020` instance with the same options and annotation keywords.
- `migrations/src/lib/attribution.js` and
  `migrations/src/authority-opinions-migration/migrate-authority-opinions.js`, which construct their
  own Ajv2019, use 2020 as well (or `createAjv()`, if their schemas compile under its strict mode).
- Comments and docs that name 2019-09 are updated (`payloadSchemas/DESIGN_NOTES.md`, the
  `unevaluatedProperties` comments in `opinionAttribution.schema.js`,
  `api/docs/response-contracts.md`).
- No schema keyword changes. If any schema turns out to use a keyword whose meaning differs between
  the drafts, that is a finding to resolve here, not to carry forward.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `payload-schema-variants`: the `createAjv()` requirement names draft 2020-12 instead of 2019-09.
- `payload-schemas-boundary`: its scenario naming `ajv/dist/2019.js` as an allowed package import
  names `ajv/dist/2020.js`.

## Impact

- **Code:** the nine `payloadSchemas/*.schema.js` files with a `$schema`, `payloadSchemas/lib/ajv.js`,
  `payloadSchemas/tests/variants.test.js` fixtures, and the two migration files above.
- **Verification:** `npm test` (sources, variants, enums, storage, the API's source-reads contract
  tests), `npm run test:integration`, and a re-run of `node migrations/src/audit-payloads.js` against
  localhost, which should report the same results as before.
- **Data integrity:** none expected. Stored jsonb is unchanged; only the validator's draft changes,
  and the audit re-run confirms that every stored payload validates exactly as before.
- **API:** no response or parameter changes.
