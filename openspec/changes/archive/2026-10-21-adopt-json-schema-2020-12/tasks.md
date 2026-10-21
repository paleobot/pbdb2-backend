## 1. Baseline (before any edit)

- [x] 1.1 Run `node migrations/src/audit-payloads.js` against localhost on the unchanged tree and
      keep its per-entity summary lines (`audit <entity>: checked=<n> violations=<n>`) outside the
      repository, for 4.3

## 2. Draft

- [x] 2.1 Change `$schema` to `https://json-schema.org/draft/2020-12/schema` in the eight sources
      (`collection`, `specimen`, `person`, `reference`, `authority`, `schema`, `character`, `state`)
      and `opinionAttribution.schema.js`; reword its two "new with Draft 2019-09" comments so they
      no longer imply 2019-09 is in use
- [x] 2.2 `payloadSchemas/lib/ajv.js`: import `ajv/dist/2020.js`, same options and annotation
      keywords; the header comment gives the reason (OpenAPI 3.1's dialect; `unevaluatedProperties`
      still rules out drafts before 2019-09)
- [x] 2.3 `payloadSchemas/tests/variants.test.js`: the two fixture `$schema` values become 2020-12
- [x] 2.4 `payloadSchemas/tests/sources.test.js`: assert every source and `opinionAttributionSchema`
      declares 2020-12, and every variant derived from each source carries it

## 3. Opinion migrations

- [x] 3.1 `migrations/src/lib/attribution.js`: compile `opinionAttributionSchema` with `createAjv()`
      instead of its own `ajv/dist/2019.js` instance
- [x] 3.2 `migrations/src/authority-opinions-migration/migrate-authority-opinions.js`: the same
- [x] 3.3 Confirm no `ajv/dist/2019.js` import remains outside `migrations/migration_exploration/`
      (superseded, left as is per design.md)

## 4. Docs and verification

- [x] 4.1 `payloadSchemas/DESIGN_NOTES.md`: the `$schema` in the "wrong" example uses the 2020-12 URL;
      `api/docs/response-contracts.md` §5: JSON Hyper-Schema's 2019-09 is no longer "the draft the
      payload schemas already use"
- [x] 4.2 `npm test` and `npm run test:integration` pass
- [x] 4.3 Re-run `node migrations/src/audit-payloads.js`; every summary line matches the 1.1 baseline
- [x] 4.4 Validate every stored `attribution` in `name_opinions`, `assignment_opinions` and
      `validity_opinions` with the validator `attribution.js` now builds: 675,615 valid, 0 invalid
      (546,498 + 128,951 + 166, the counts measured before the change)
- [x] 4.5 `openspec validate adopt-json-schema-2020-12` passes
