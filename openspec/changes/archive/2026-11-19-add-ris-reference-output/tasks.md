## 1. Serializer

- [x] 1.1 Create `api/src/lib/ris.js` exporting `risSerializer(source, { baseHref })` → `{ header, record }`; `header()` returns `''`
- [x] 1.2 Map `publicationType` (and `bookType` for theses) to `TY` per the `ris-output` table, with `M3` = `bookType` on `THES` only
- [x] 1.3 Write the tags in the spec's order with its precedence rules: `ID`, `UR` (`baseHref/permid`), `DB`, `AU` (`Family, Given`; given-only; skip empty), `A2`/`A3` by `TY`, `PY`, `TI`, `T2` (journal → book → series title), `VL` (journal → series volume), `IS` (journal → series number), `SP`, `EP` (only when it differs), `PB`, `CY`, `N1` comments, `N1` description, `LA`, `DO`; omit absent or blank values; never export `legacyIDs`
- [x] 1.4 Encode lines as `TAG  - value` + CRLF; collapse whitespace runs containing CR/LF to one space and trim; no truncation; end each record with `ER  - ` CRLF then a blank line (CRLF), so records are separated without per-response state
- [x] 1.5 Unit tests in `api/test/ris.test.js`: every `TY` row (thesis with `M3`, monograph without), each tag and its omission, the `T2`/`VL`/`IS` precedence (serial monograph `seriesNumber` → `IS`), single page (no `EP`), two `N1` lines in order, no title, author forms, `A2` vs `A3` by type, a multi-line comment, non-ASCII text, two records separated by one blank line, exact byte output for one full record

## 2. Registry and routes

- [x] 2.1 Register `application/x-research-info-systems` in `api/src/lib/formats.js` (`contentType` with `charset=utf-8`, `extension` `ris`, `serializer` `risSerializer`)
- [x] 2.2 Pass `{ baseHref: fastify.publicBaseUrl + fastify.prefix }` as the serializer factory's second argument where `crud-routes.js` builds serializers; `csvSerializer` ignores it (design D2)
- [x] 2.3 Add a `singleFormats` option to `registerCrudRoutes`: the single read declares `config: { formats: singleFormats }`, negotiates, and for a non-JSON type reads the head (missing → JSON 404) and sends `header() + record(hydrated)` with `Content-Disposition: attachment; filename="<permid>.<extension>"`; `HEAD` sends headers only (design D3)
- [x] 2.4 Offer RIS on references: `formats: ['text/csv', 'application/x-research-info-systems']`, `singleFormats: ['application/x-research-info-systems']` in `api/src/routes/api/v1/references/index.js`
- [x] 2.5 Add a RIS entry to `FORMAT_DOCS`, and let `singleRouteSchema` take the single read's formats and describe their 200 content beside JSON, as `listRouteSchema` does (`api-description`)

## 3. Route tests

- [x] 3.1 Negotiation and 406 (unit, `app.inject()`): RIS selected on the references list, `ids` and single read; wildcard and tie → JSON; RIS ranked above CSV → RIS; RIS on authorities, schemas and a collection single read → 406; CSV on the reference single read → 406; `Vary: Accept` and `Content-Disposition` filenames (`references.ris`, `<permid>.ris`)
- [x] 3.2 Single read: 200 with one record from `TY` to `ER`; unknown permid → JSON 404; `HEAD` → headers, no body; unknown query parameter → 400
- [x] 3.3 List behaviour shared with CSV: `limit` page with `Link`, `ids` without `Link`, invalid filter → JSON 400, empty result → 200 with empty body, an unbounded RIS export counted against the shared export cap (503 with `Retry-After` when CSV exports hold every slot)
- [x] 3.4 OpenAPI (`api/test/openapi.test.js`): references list documents JSON, CSV and RIS; reference single read documents JSON and RIS, no CSV; authorities list and collection single read document no RIS; the document still validates as OpenAPI 3.1
- [x] 3.5 `npm test` passes at the repository root

## 4. Integration against localhost

- [x] 4.1 Add `api/test/integration/ris-output.test.js`: a streamed whole RIS export of references holds one record per reference, in `permid_no` order, each with `TY`, `ID`, `UR`, `DB` and `ER`; a chapter exports as `CHAP` with `T2`; a serial monograph with `seriesNumber` exports `IS`; a filtered export holds exactly the filtered records
- [x] 4.2 `npm run test:integration` passes
- [x] 4.3 Export the whole references table as RIS from a running server against localhost and record in this change the count of records by `TY`, checking that it matches the count of references by type (thesis split by `bookType`)

## 5. Zotero import check

- [x] 5.1 Clone `zotero/translation-server` (with its translators submodule) into the scratchpad, outside the repository, and start it with Node on localhost
- [x] 5.2 Build a sample RIS file from localhost covering every `TY` (at least two records each, including a chapter with editors, a serial monograph with series number and editors, a thesis, an unpublished ref with a description, a ref with a multi-line comment and one with non-ASCII authors), and `POST` it to the server's `/import`
- [x] 5.3 Check the returned items: item type per `TY` as in design D4; creators (authors as authors, editors as editors, not series editors), container title, volume, issue or series number, pages, DOI, URL, language and notes land in the expected Zotero fields
- [x] 5.4 If `A2`/`A3` imports as series editor for `THES`, `UNPD` or `GEN`, or any other tag lands in the wrong field, correct design D5/D6 and the `ris-output` spec, update the serializer and its tests, and re-run 5.2–5.3
- [x] 5.5 Record the result (translation-server commit, items checked, any corrections) in this change's design under Risks, and delete the clone

## 6. Docs

- [x] 6.1 Add `api/docs/ris-output.md`: how to request RIS, which reads offer it, the `TY` and tag tables, editors as one line, encoding, the differences from Classic (design D8), and that the mapping was checked against Zotero's importer only
- [x] 6.2 Update `api/CLAUDE.md`: formats registry lists RIS, `lib/ris.js` in the layout, references offering RIS on the single read, and RIS among the unenveloped successes
- [x] 6.3 Update the "Output formats beyond CSV" entry in `docs/api-design-backlog.md` to point to this change for RIS (whether to mark it done or remove it is decided at archive)

## 7. Verification and rollback

- [x] 7.1 `openspec validate add-ris-reference-output --strict` passes
- [x] 7.2 Confirm every JSON and CSV response is unchanged: the existing unit, CSV and integration suites pass without edits to their expectations (one exception, required by `api-description`: `openapi.test.js` now expects RIS beside JSON and CSV on the references list)
- [x] 7.3 Rollback is a revert of this change's commits; no data, schema or DDL step to undo
