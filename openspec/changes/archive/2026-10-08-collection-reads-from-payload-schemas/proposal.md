## Why

Collection GETs still return the stored jsonb plus SQL link enrichment. As a result they drop the
coordinates, which live in `collections.location`. All 275,554 heads on localhost have a location,
and none of them shows coordinates. Their reference fields (`primaryReference`,
`additionalReferences`) also match no schema. `authority-reads-from-payload-schemas` built design A
(`api/docs/response-contracts.md` §6) for authorities. This change applies it to collections, which
also need coordinates and an array of links rather than one link.

How a collection's references should be modelled has gone to committee, along with whether their
order is real data. Until there's an answer, the source describes what is stored now: a primary
reference in `collections.reference_id`, plus an unordered set of rows in
`additional_collection_refs`. The response fields keep their current names, so the reference part
of the response doesn't break.

## What Changes

- **Collection reads go through `merge()`.** GET `/collections`, `/collections/{permid}` and `?ids=`
  return the merged payload, validated against the collection `out` variant.
  - `location.coordinates.latitude`/`longitude` come back from `collections.location`.
  - `permid` comes from its column.
- **The collection source describes the stored references.** Its `references[]` (`{ permid, order }`,
  through `referenceList`) is replaced by two links:
  - `primaryReference`: one link (`{ permid, title, href }`) from `collections.reference_id`,
    through `referencePermid`, as on authorities. It is `null` when that reference has been removed.
  - `additionalReferences`: an **unordered** array of links, one per `additional_collection_refs`
    row, through a new `referenceLinks` codec. A removed reference is left out, and the array is `[]`
    when nothing remains. There is no `order`.
- **The rows are returned as stored.** For 242,310 of the 242,412 collections that have child rows,
  the primary is also one of those rows. Classic's `secondary_refs` lists it there, and the
  migration copies that table as it is. So `additionalReferences` usually repeats
  `primaryReference`, as today's API already does. Neither the data nor the migration changes here.
  Whether the repeat goes away depends on the committee's answer about order.
- **Response shape:** the reference fields keep today's names and shape, `{ title, permid, href }`,
  with a removed primary as `null` and removed additional references omitted. The jsonb fields are
  unchanged, because the audit shows the stored jsonb holds only source fields. The only new fields
  are the coordinates.
- **Links inside arrays.** `x-link` can be placed on an array's items, and the machinery built for
  root links reaches into `items`:
  - label loading;
  - the codec's `storage.link`;
  - `href` hydration.

  Items are not made nullable in `out`. A removed item is left out instead.
- **Child rows and computed columns in the repository.** A source-backed read also loads the child
  rows that `merge()` needs, here the page's `additional_collection_refs`. It also selects a column
  through the expression its codec expects (`ST_AsGeoJSON(location)::json` for `wgs84Point`). The
  codec context is restricted to the reference ids held in the page's columns and child rows,
  rather than reading all of `refs`.
- **Stub** reads take the collection source's shape.
- **Unchanged:** schemas (their source keeps `references[]` and `referenceList`, and their read
  stays on `schema-tree.js`), taxa, references, specimens, the envelope, and the migrations' data.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `payload-schema-variants`:
  - `x-link` is allowed on array items. `collectCodecSources` and the codec's `storage.link` reach
    them;
  - `out` makes only a link **property** nullable, not a link item;
  - `referencePermid` emits under the name of the property it serves, not a fixed `reference`;
  - new `referenceLinks` codec: an unordered child table of reference links;
  - the collection source replaces `references[]` with `primaryReference` and
    `additionalReferences`;
  - `codecKeyColumns` leaves out a source that a child-table codec also reads.
- `data-access`:
  - a source-backed read loads child rows and codec-expression columns;
  - the codec-context selection covers keys held in child rows;
  - `collections` joins `authorities` as a source-backed resource, with contract tests.
- `reference-enrichment`:
  - collection reference links come from the source, not `LINK_TARGETS`. The field names and shape
    are unchanged;
  - the stub requirement changes for collections;
  - schemas keep `LINK_TARGETS`.

## Impact

- **Code:**
  - `payloadSchemas/`:
    - `lib/storage.js`: the items rule, the property name, `storageSelects`, `codecKeySites`, and
      `codecKeyColumns`;
    - `lib/codecs.js`: `referencePermid`, the new `referenceLinks`, and the `wgs84Point` select;
    - `lib/variants.js`;
    - `collection.schema.js`;
  - `api/src/lib/`:
    - `repository.js`: child rows, expression columns, and selection from children;
    - `link-hydration.js`: items;
    - `resource-tables.js`: collections drops `links` and gains `source`;
  - `api/src/routes/api/v1/collections/`;
  - tests in both areas.
- **API clients:**
  - `primaryReference` and `additionalReferences` keep their names and shape, and the primary is
    still repeated in most `additionalReferences`;
  - coordinates appear for the first time;
  - the stub's `country` and `state` move to where the source keeps them.
- **Create body (no write route yet):** it sends `primaryReference: { permid }` and
  `additionalReferences: [{ permid }]` instead of `references[]`.
- **Migrations:** `migrations/src/audit-payloads.js` round-trips collections through the two
  codecs. Re-running the collection audit on localhost (275,554 heads, currently 0 violations and 0
  differences) confirms it. Schemas are re-audited because they share `storage.js`.
- **Load:** a page of collections adds one child-row query and one `refs` query. On localhost there
  are 371,774 child rows over 242,412 collections, at most 455 on one collection.
- **Deferred:** the reference model (order, and whether the primary belongs in the child table)
  waits for the committee. It is recorded in `docs/api-design-backlog.md`.
