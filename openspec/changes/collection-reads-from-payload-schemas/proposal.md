## Why

Collection GETs still return the stored jsonb plus SQL link enrichment. So they drop the coordinates,
which live in `collections.location`: all 275,554 heads on localhost have a location, and none of
them shows coordinates. And their reference fields (`primaryReference`, `additionalReferences`)
match no schema. `authority-reads-from-payload-schemas` built design A
(`api/docs/response-contracts.md` §6) for authorities. This change applies it to collections, the
resource that needs the most from it: coordinates, and a list of links rather than one.

## What Changes

- **Collection reads go through `merge()`.** GET `/collections`, `/collections/{permid}` and `?ids=`
  return the merged payload, validated against the collection `out` variant.
  - `location.coordinates.latitude`/`longitude` come back from `collections.location`.
  - `permid` comes from its column.
- **BREAKING (API clients): `references[]` replaces `primaryReference` and `additionalReferences`.**
  A collection's references are one ordered array, `[{ permid, order, title, href }]`. The primary
  is the item with `order: "1"`. Every item is a link: `title` and `href` are read-only, and a
  create sends `{ permid, order }`.
- **Removed references are omitted, and orders keep their stored values.** An item citing a
  soft-removed reference is left out of `references[]`, and the remaining items keep the orders
  `merge()` derives from storage. So a gap (`"1"`, `"3"`) shows that something was removed. If the
  primary is the removed one, no item has order `"1"`. This keeps today's "omitted" rule.
- **Links inside arrays.** `x-link` can sit on an array's items, and the machinery built for root
  links has to reach into `items` as well:
  - label loading;
  - the codec's `storage.link`;
  - nullable-in-`out`: not used for items, which are omitted instead;
  - `href` hydration.

  The `link` helper takes extra item properties (`order`).
- **Child rows and computed columns in the repository.** A source-backed read also loads the child
  rows `merge()` needs, here `additional_collection_refs` for the page. It also selects a column
  through the expression its codec expects (`ST_AsGeoJSON(location)::json` for `wgs84Point`). The
  codec context is restricted to the reference ids the page's columns and child rows hold, rather
  than reading `refs` in full.
- **Stub** reads take the collection source's shape.
- **Unchanged:** schemas (read through `schema-tree.js`, a later change), taxa, references,
  specimens, and the envelope.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `payload-schema-variants`:
  - `link` takes extra properties;
  - `x-link` is allowed on array items;
  - `collectCodecSources` and the codec's `storage.link` reach items;
  - `referenceList` emits labelled link items and omits removed references, without renumbering;
  - collection `references` items become link items.
- `data-access`:
  - a source-backed read loads child rows and codec-expression columns;
  - the codec-context selection covers keys held in child rows;
  - `collections` joins `authorities` as a source-backed resource, with contract tests.
- `reference-enrichment`:
  - collection reads embed `references[]` from the source, not `primaryReference` and
    `additionalReferences` from `LINK_TARGETS`;
  - the stub requirement changes for collections;
  - schemas keep the old shape.

## Impact

- **Code:**
  - `payloadSchemas/lib/links.js`, `lib/storage.js`, `lib/codecs.js` (`referenceList`, and
    `wgs84Point` metadata for its select expression), `lib/variants.js` if items need handling, and
    `collection.schema.js`;
  - `api/src/lib/repository.js` (child rows, expression columns, selection from children),
    `link-hydration.js` (items), `resource-tables.js` (collections drops `links`, gains `source`),
    `routes/api/v1/collections/`;
  - tests in both areas.
- **API clients:** `primaryReference` and `additionalReferences` go away for collections, and
  `references[]` replaces them. Coordinates appear for the first time. Schemas still return
  `primaryReference` and `additionalReferences` until their change.
- **Migrations:** `migrations/src/audit-payloads.js` round-trips collections through
  `referenceList`. Once labels are loaded, the merged items carry `title`, and split must ignore it.
  Re-running the collection audit on localhost (275,554 heads, currently 0 violations and 0
  differences) confirms it. With 0 removed references, omission can't create a difference there.
- **Load:** a page of collections adds one child-row query and one `refs` query. On localhost there
  are 371,774 child rows over 242,412 collections, at most 455 on one collection.
- **Data integrity:** reads only. On the write path, omitting a removed reference means a
  GET → PATCH round trip would drop that citation. This is recorded for the write path, as with the
  authorities change's nested `readOnly` guard.
