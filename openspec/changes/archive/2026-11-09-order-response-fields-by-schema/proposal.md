## Why

Read responses list a record's fields in Postgres JSONB key order (shortest key first, then bytewise), with column-backed fields such as `permid` appended after them. A person browsing the API finds a reference starting `doi, pages, title, authors…` and its `permid` last. The order means nothing to a JSON parser, but it makes the responses hard to read in a browser.

## What Changes

- Records read through a payload source are emitted in the order their schema declares, with any undeclared keys after the declared ones. Nested objects the schema declares follow the same rule.
- `permid` is the first field of every entity: records, characters and states in the schema tree, and link objects, including the taxa links that today put their label first.
- Each payload schema is reordered so `permid` comes first, immediately followed by the field that labels the record (`name` or `title` where the schema declares one, `citation` on an authority), and `legacyIDs` comes last, which also changes the field order of the published OpenAPI components.
- No field is added, removed or renamed. JSON objects remain unordered, so this is a presentation convention rather than something clients should parse by.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `api-foundation`: adds the field-order convention for response entities.

## Impact

- `payloadSchemas/lib/storage.js`: `mergeNode` orders its output by the schema. `merge()` is also used by the payload audit (`migrations/src/audit-payloads.js`).
- `payloadSchemas/*.schema.js`: property order only.
- `api/src/lib/repository.js`: `labelObject` emits `permid` first, with the matching SQL assertions in `api/test/link-enrichment.test.js`.
- Tests: new assertions on key order, since deep-equal comparison and schema validation both ignore it.
- Data integrity: no database, DDL or migration change. Stored payloads are not rewritten, and the change affects only the order of keys in objects built for output.
