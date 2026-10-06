## Why

The API reads payload rows as stored jsonb (`{ permid, ...row.payload }`) and never calls `merge()`, so
fields stored in columns go missing, and no JSON Schema describes what a GET returns. Writes depend on
reads: a PATCH merges the stored row before validating it, and a create body must agree with GET. So
reads have to move onto the payload schemas first. `api/docs/response-contracts.md` chose design A
(links inside the payload, declared in the source; §6). This change builds it and proves it on
authorities, the smallest resource with a link.

## What Changes

- **Annotations.** `readOnly` is allowed at any depth, not just on root properties. `deriveVariant`
  drops nested read-only fields from `in-create`. `unevaluatedProperties: false` then rejects them
  in a body, and the 400 names the path. A new `x-link: { target, label }` annotation marks a field
  as a link to another resource and names the target field to embed as its label.
- **Codecs.** A codec context can map a key to an object (`{ permid, label }`) rather than a single
  value. Lookups skip soft-removed targets as well as superseded ones, as the API's link SQL does
  today.
- **Authority source.** `reference` changes from a permid string to a link object:
  `{ permid, title, href }` in `out`, where `title` and `href` are `readOnly`. A create body sends
  `{ permid }`. **BREAKING** for the `in-create` contract; no route accepts a create yet. The
  jsonb at rest is unchanged, because `reference` lives in `authorities.reference_id`.
- **Authority reads.** GET `/authorities` and `/authorities/{permid}` are built with `merge()` and
  the codec context, loaded once per page. `href` is added at the API boundary.
  The link object keeps the `{ title, permid, href }` keys clients see today. Stub reads change to
  the same shape.
- **Contract test.** Each authority GET response is validated against the authority `out` variant.
- **Unchanged.** Collections, schemas and taxa keep `LINK_TARGETS` and their link SQL until they get
  the same treatment in later changes. The response envelope (`data`, `meta`, `links`) is unchanged.

**Prerequisite:** `rename-reference-link-id-to-permid`, which renames `referenceID` to `permid` in the
collection and schema `references[]` items. Link objects name their target's id `permid` everywhere
(`api/docs/response-contracts.md` §4). This change assumes that rename has landed.

## Capabilities

### New Capabilities

None. The behaviour belongs to existing specs.

### Modified Capabilities

- `payload-schema-variants`:
  - the annotation vocabulary gains nested `readOnly` and `x-link`
  - `in-create` and `out` handle nested read-only fields
  - the codec context can map a key to an object and skips removed targets
  - the authority source's `reference` becomes a link object
  - `referencePermid` yields `{ permid, title }`
- `data-access`: the head-read repository returns a merged payload for a resource with a payload
  source, with its codec context loaded once per page. A contract test checks GET responses against
  `out`.
- `reference-enrichment`: an authority's `reference` comes from `x-link` and `merge()`, not from
  `LINK_TARGETS`. Its shape stays `{ title, permid, href }`, and stub reads match it. The
  registry requirements stay for collections, schemas and taxa.

## Impact

- **Code:**
  - `payloadSchemas/lib/variants.js` (nested `readOnly`, `x-link`); `lib/storage.js` and
    `lib/codecs.js` (object-valued context, removed filtering, `referencePermid`)
  - `payloadSchemas/authority.schema.js` and its tests
  - `api/src/lib/repository.js` (`toResource` via `merge()`), `resource-tables.js` (authorities
    drops its `links` entry), `link-hydration.js` (`href` for `x-link` fields), and
    `routes/api/v1/authorities/`
  - API integration tests
- **Migrations:** `migrations/src/audit-payloads.js` merges and splits authorities in its round-trip
  check. It must load the new context and split the object form. The authorities migration writes the
  `reference_id` column directly and is unaffected. Re-running the audit on localhost checks this.
- **API clients:**
  - authority reads now carry `legacyIDs` and every stored field, where the stub previously showed
    invented `taxonName`/`rank` keys
- **Data integrity:** reads only; nothing is written. The risk is presentation. A `reference_id` the
  context cannot resolve makes `merge()` throw, which would turn one bad row into a 500 for its whole
  page. `authorities.reference_id` is NOT NULL, but its target can be soft-removed. That case must
  resolve the way the spec says today (`reference: null`), not by failing, and `out` must allow it.
  The design settles how.
- **Docs:** `api/docs/response-contracts.md` (status, open questions) and the "API responses vs. the
  `out` variants" entry in `docs/api-design-backlog.md`.
