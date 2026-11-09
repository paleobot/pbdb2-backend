## Context

Responses are serialized with plain `JSON.stringify`, so the key order sent is the order in which each object was built.

- `mergeNode` (`payloadSchemas/lib/storage.js`) starts from `{ ...value }`, the stored JSONB, whose keys Postgres returns shortest first and then bytewise. It then appends column-backed fields, so `permid` follows every payload key.
- Taxa do not use `merge()`. Their `BASE_COLUMNS` already match `taxon.schema.js`, and `permid` comes first.
- Link objects built by the payload codecs are already `permid, title, href`. Taxa links are built by `labelObject` (`api/src/lib/repository.js`) as `<label>, permid`, with `href` added afterwards.
- `merge()` is also called by the payload audit, which validates the result and round-trips it through `split()`.

## Goals / Non-Goals

**Goals:**

- Every entity in a read response has `permid` first.
- A record's fields follow its schema's declared order, so the schema file is the one place that sets it.
- A record's `name`, `title` or, on an authority, `citation` comes right after its `permid`, so a reader sees what the record is first.
- `legacyIDs` no longer sits near the top of a record.

**Non-Goals:**

- Rewriting stored payloads. JSONB does not preserve key order, so it could not hold one anyway.
- Ordering objects inside arrays that `mergeNode` does not walk, such as the entries of `authors`. They stay in stored order.
- Reordering stub records, which are hand-written and already have `permid` first.
- Any other rearrangement of the schemas. Fields other than `permid`, `name`, `title`, `citation`, `legacyIDs` and a reference's `publicationType` keep their relative order.

## Decisions

### Order in `mergeNode`, from `schema.properties`

After `mergeNode` has built `out`, it rebuilds the object: each key in `schema.properties` that is present, in that order, then the remaining keys in their existing order. Because `mergeNode` already recurses into declared nested objects, those are ordered too. Characters and states get this through their own `merge()` calls in `schema-tree.js`.

Undeclared keys are kept, after the declared ones: `merge()` must not drop data.

Alternatives considered:

- **Move only `permid`.** A one-line change, but a reference would still read `permid, doi, pages, title…`, leaving most of the problem.
- **Reorder in the serializer with a `JSON.stringify` replacer.** It would reach any object with a `permid`, but it runs on every node of every response, including large `containingTaxa` pages, and routes with no response schema bypass the serializer compiler. It moves only `permid` unless it also learns the schemas.
- **Reorder at the API boundary, after `merge()`.** `merge()` is the point that knows the schema and every read goes through it. A separate pass would need to walk the schema a second time.

### `permid` first, then the record's label, `legacyIDs` last, in the schema files

Each schema that declares `legacyIDs` moves it to be its last property: reference, authority, collection, schema, character, state, specimen and person.

Where a schema declares `name` or `title`, that field directly follows `permid`. An authority has neither, so `citation`, already the label on its links, takes that place. Three schemas need a move for this: `reference.schema.js` becomes `permid, title, publicationType, authors…`, `schema.schema.js` moves `title` above `primaryReference`, and `authority.schema.js` moves `citation` above `reference`. `reference.schema.js` is also the only schema where `permid` is not already first. Collection, specimen and taxon already have `name` second, and character and state do once `legacyIDs` moves.

Person declares no single label field, so it is unaffected by this rule.

Variants derive their properties from these objects, so the published OpenAPI components change order to match.

On a single schema read, `characters` is added after `merge()`, so it follows `legacyIDs`. That is acceptable: the tree is the bulk of the response and reads naturally at the end.

### Taxa links: swap `labelObject`'s arguments

`json_build_object` keeps argument order, so both forms emit `permid` before the label. `href` is still appended at hydration. This makes every link `permid, <label>, href`.

### The convention is stated as presentation

JSON objects are unordered, so the requirement in `api-foundation` says clients must not depend on it. It is still tested, because nothing else would notice a regression: deep-equal and schema validation both ignore key order.

## Risks / Trade-offs

- [The audit round-trip is affected by key order] → `split()` receives the same keys in a new order, and stored JSONB normalizes order. A `--round-trip` audit run on localhost confirms there are no new differences.
- [Tests pin the old order] → `payloadSchemas/tests/sources.test.js` asserts `Object.keys` of derived variants, and `api/test/link-enrichment.test.js` matches the `labelObject` SQL. Both are updated deliberately in this change.
- [Rebuilding each object costs time on large pages] → It is one small allocation per merged object, on pages capped by the list limit, and each already costs a spread.
- [A new schema property is added in a poor position] → The schema's order is the display order, so that is a visible and easy fix in one file.

## Migration Plan

No database or data step. Deploying the API applies the new order and rolling it back restores the old one. Field names and values do not change.

## Open Questions

None.
