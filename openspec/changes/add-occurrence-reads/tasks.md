## 1. Payload schemas

- [ ] 1.1 `payloadSchemas/lib/storage.js`: a codec source may declare `labelColumns: true` instead of `payload`. `collectCodecSources` checks that a source carrying `labels` declares exactly one of the two, and `loadCodecContext` reads each label as the column `"<label>"` for such a source. Add unit tests for both forms and for declaring both.
- [ ] 1.2 `payloadSchemas/lib/codecs.js`: add the `taxonPermid` codec over `{ table: "taxa", key: "permid", value: "permid", labelColumns: true }`.
  - `merge` emits `{ permid, name }`, or `{ permid }` when `taxa` has no row (no throw), or nothing for NULL.
  - `split` writes the permid to the column unchanged.
  - Unit tests with a hand-built context cover each case.
- [ ] 1.3 `payloadSchemas/identification.schema.js`: add the `taxon` and `reference` link properties (`x-storage` with `taxonPermid` / `referencePermid`). Tests:
  - the `db` variant is unchanged (and rejects either key);
  - the `out` variant declares both links;
  - `collectCodecSources` returns the `taxa` and `refs` sources.
- [ ] 1.4 Add `payloadSchemas/occurrence.schema.js` (`occurrenceSource`, read-only root), with properties in the spec's order. The ranks are taken from `identificationSource.properties.identification.properties`, and `plantOrgans` from the identification source. Register it in `payloadSchemas/tests/sources.test.js`. Tests:
  - every allowed variant compiles;
  - `db` is empty;
  - `in-create` throws;
  - the genus resolution enum is the same array as the identification source's.
- [ ] 1.5 `npm test` passes at the repository root.

## 2. Payload audit round trip

- [ ] 2.1 `migrations/src/audit-payloads.js`: the identification entry selects `taxon_permid` and `reference_id` (its `columns`), so merge and split can rebuild the two links.
- [ ] 2.2 Run `node src/audit-payloads.js --entity identification --round-trip` from `migrations/` against localhost `pbdb`, on all heads (2,046,335), not a sample. Confirm zero violations and zero differences, including the 547 roots whose taxon has no `taxa` row. Record the run in design.md.

## 3. API library

- [ ] 3.1 `api/src/lib/resource-tables.js`:
  - add `collections` to `LINK_TARGETS` (`collections` table, payload column `collection`, label `name`);
  - add the `occurrences` descriptor (table, `readOnly`, links, and the `collection`/`taxon`/`withinTaxon` link filters with their prefixes).
- [ ] 3.2 Link-filter kinds in `api/src/lib/field-filter-ops.js`, so query schemas, strict-parameter recognition and descriptions come from the existing seam.
  - Parameter schema: `^<PREFIX>-\d+-\d{2}$`, non-empty, with a 400 message naming the parameter.
  - Unit tests: a wrong prefix, `123`, an empty value and a repeated parameter are each a 400.
- [ ] 3.3 `api/src/lib/identified-name.js`: the `name` formatter of `occurrence-reads` ("Formatted identification name"). Unit tests cover:
  - every rule row;
  - the spec's scenarios;
  - a subspecies with `forma`;
  - no ranks → `null`.
- [ ] 3.4 `api/src/lib/link-hydration.js`: a link object that has no label gets no `href` (the orphan taxon case); every existing link keeps its `href`. Add unit tests for both.

## 4. Occurrence repository

- [ ] 4.1 `api/src/lib/occurrence-repository.js`: `readHead` / `readHeads` over `occurrences`. The query:
  - joins the winning identification (`w`), the identified taxon (`it`) and the current abundance;
  - resolves links with `linkProjections(…, alias)` for `o`, `w` and `it`;
  - pages by `permid_no` and accepts `ids`;
  - has no `removed` predicate on the cache;
  - shapes rows into the representation with lifted ranks and `name`.
- [ ] 4.2 Filters:
  - `collection`: the head id by permid;
  - `taxon`: `o.taxon_permid = $n`;
  - `withinTaxon`: resolve to the concept, walk `containing_concept_permid` with `WITH RECURSIVE`, then take every `taxa` row of those concepts, matched with `= ANY`.
  - The taxon set is resolved once per request and reused across the batches of a streamed export.
- [ ] 4.3 Nested reads in the same module, through `merge(identificationSource, …)` with one codec-context load per page restricted to the page's `reference_id` and `taxon_permid` values:
  - the list: current, non-removed heads with `occurrence_permid = $1`, paged by `permid_no`, `ids` accepted, `null` when the occurrence has no row;
  - the single read: `null` when missing or when it belongs to another occurrence;
  - both add `name`.
- [ ] 4.4 `occurrenceRepository(fastify)` returns undefined with no `pg` decorator (no stub).

## 5. Routes and published schemas

- [ ] 5.1 `api/src/lib/published-schemas.js`: add `Occurrence` (from `occurrenceSource`), `Identification` (the identification `out` variant plus `name`) and `CollectionLink`.
- [ ] 5.2 `api/src/routes/api/v1/occurrences/index.js`:
  - `registerCrudRoutes` with `readOnly`, `type: 'occurrence'`, `component: 'Occurrence'`, `formats: ['text/csv']` and `exportSource: occurrenceSource`;
  - a stub that throws 503, as taxa's does;
  - a `hydrate` adding `href` to `collection`, `reference` and `acceptedTaxon`, to `identification.taxon` and `identification.reference`, and the embedded identification's own `href` (`<base><prefix>/<occurrence permid>/identifications/<permid>`).
- [ ] 5.3 In the same plugin, the nested routes `GET /:permid/identifications` and `GET /:permid/identifications/:identificationPermid`:
  - querystring schemas: the universal list parameters on the list, none on the single read;
  - response components and `meta.type` `identification`, with links hydrated;
  - 404 for an unknown occurrence and for an identification of another occurrence;
  - no formats (CSV → 406) and no write verbs.
- [ ] 5.4 Check that discovery lists `occurrences` and no nested segment, and that the description documents the four GETs and hides the 405 routes. Adjust `plugins/discovery.js` or `plugins/openapi.js` only if a nested route leaks or goes missing.

## 6. Unit tests (`app.inject()`, fake pg)

- [ ] 6.1 Routing:
  - write verbs → 405 with `Allow`;
  - no database → 503 on the list, the single read and the nested routes;
  - an unknown parameter → 400 on all four GETs;
  - CSV on the nested list → 406.
- [ ] 6.2 Representation shaping:
  - field order;
  - lifted ranks with no `identification.identification`;
  - root vs. winner reference kept apart;
  - an orphan taxon is `{ permid }` with no `href`, and `acceptedTaxon` is `null`;
  - `abundance` is `null` when absent;
  - no internal columns.
- [ ] 6.3 Discovery (`occurrences` listed, no `identifications`), OpenAPI (four GETs, the three filter parameters, no write operations, the document still valid 3.1) and CSV columns (header from `occurrenceSource`, including `identification.name`, `identification.taxon.permid`/`.name`, `identification.reference.permid` and `acceptedTaxon.name`).
- [ ] 6.4 Every read in 6.1–6.3 validates against its published component (`test/published.js`).
- [ ] 6.5 `npm test` passes at the repository root.

## 7. Integration tests

- [ ] 7.1 `api/test/integration/occurrences.test.js` fixtures, with permids minted through `mintPermid(pool, prefix)`, then `rebuild_occurrences()`. They provide:
  - collections, references and taxa (one genus with a species and a junior synonym);
  - an occurrence whose reidentification wins with a different reference;
  - an occurrence whose taxon permid has a name opinion but no `taxa` row;
  - an occurrence with an abundance.
- [ ] 7.2 Reads:
  - the single read (root vs. winner reference, `acceptedTaxon` of a synonym, the orphan taxon, abundance);
  - list pagination;
  - `ids`;
  - 404s;
  - every item valid against `Occurrence`.
- [ ] 7.3 Filters:
  - `collection`;
  - exact `taxon` (the genus misses its species);
  - `withinTaxon` (the genus finds its species and synonym; a synonym's permid gives the senior's result; the orphan is excluded);
  - combined filters;
  - a well-formed unknown permid gives an empty 200.
- [ ] 7.4 Nested:
  - the list (root first), the single read, an identification of another occurrence → 404;
  - every item valid against `Identification`;
  - the embedded `identification.href` resolves to the winner's full record.
- [ ] 7.5 CSV: a filtered occurrence export has one record per occurrence with the expected columns, and a streamed whole export works.
- [ ] 7.6 `npm run test:integration` passes.

## 8. Verify on localhost

- [ ] 8.1 Run the server against localhost `pbdb` and check the measured counts:
  - `collection` = the collection with 1,227 occurrences gives 1,227 across its pages;
  - `taxon=TXN-38613-69` gives 14 and `withinTaxon=TXN-38613-69` gives 167 (*Tyrannosaurus*);
  - one occurrence with a winning reidentification shows two different references.
- [ ] 8.2 Time the reads warm and record them in design.md:
  - a page of 100 and of 1,000;
  - `withinTaxon` pages for *Tyrannosaurus*, Productidae, Mammalia and Brachiopoda;
  - a streamed CSV export of `withinTaxon=Mammalia` (94,121 rows), confirming the taxon set is resolved once.

## 9. Docs and wrap-up

- [ ] 9.1 `api/CLAUDE.md`:
  - layout gains `occurrences/` and `lib/occurrence-repository.js` / `lib/identified-name.js`;
  - key patterns: occurrences beside taxa as a derived read-only group, the nested identifications, link filters, and the root vs. winner reference;
  - its API spec list gains `occurrence-reads` and `api-description`.
- [ ] 9.2 Client-facing notes (`docs/csv-output.md` occurrence columns, plus a short note on `reference` vs. `identification.reference` and `taxon` vs. `withinTaxon` where the API's client docs live).
- [ ] 9.3 `docs/api-design-backlog.md`:
  - note that occurrences now exist under "Including related resources" (the `collection` → occurrences reverse href is still open);
  - add the `name` formatting parity question and the `withinTaxon` strategy choice if they are not covered elsewhere.
- [ ] 9.4 `openspec validate add-occurrence-reads --strict` and `npm test` pass. Rollback is removing the route group; nothing else depends on it, and no data changes.
