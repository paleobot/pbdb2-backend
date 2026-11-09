## 1. Negotiation

- [ ] 1.1 Add the format registry (`text/csv` only) and `negotiate(acceptHeader, formats)` in `src/lib/`, returning the media type to serve; unit tests for each Accept scenario in `csv-output` (absent, wildcard, browser, `q` preference, tie, `text/csv, */*`, `q=0`, a type the API never produces)
- [ ] 1.2 Add the `onRequest` hook in `src/app.js`: `Vary: Accept` on every `GET`/`HEAD`, and 406 in the standard error shape when the request selects a registry format the route's `config.formats` does not list; test single reads, `schemas`, an index and that a 406 precedes query validation

## 2. Columns and encoding

- [ ] 2.1 Add the column walker over the `out` variant (dotted paths, links through their nullable `out` wrapper, arrays of scalars, objects and links, nested arrays) with unit tests for each rule, using `taxonSource`, `authoritySource`, `referenceSource` and `collectionSource`
- [ ] 2.2 Add value formatting: delimiters and `\` escaping in multi-valued columns only, position-preserving blanks, and empty cells for null, absent and empty array
- [ ] 2.3 Add RFC 4180 record writing (CRLF, quoting, doubled quotes, preserved line breaks, no BOM, formula-like strings unchanged) with unit tests

## 3. List handler

- [ ] 3.1 Add a `formats` option to `registerCrudRoutes`, setting `config.formats` on the list route only, and pass `['text/csv']` for `references`, `authorities`, `collections` and `taxa` (taxa's columns from `taxonSource`)
- [ ] 3.2 Branch `listReadHandler` on `negotiate`, keeping the batch loop separate from the CSV serializer (design D6): reject a true expansion with a 400 naming it, and return one page plus a `Link` header when `limit` is sent, and the found records with no `Link` for `ids`
- [ ] 3.3 Handle absent `limit`: forward batches of `MAX_LIMIT` through `readHeads` and hydrate, streamed with `Readable.from`; a forward `cursor` starts the stream there, and a backward `cursor` without `limit` is a 400. `collectListFilters` must let the handler see whether `limit` was sent
- [ ] 3.4 Read the first batch before committing status and headers; abort the socket on a later failure; stop issuing queries when the client disconnects
- [ ] 3.5 Add `MAX_CONCURRENT_EXPORTS` to `src/config.js` and the root `.env.example` (default 4), the per-instance counter, the 503 with `Retry-After`, and release on response close; `limit` and `ids` reads don't count
- [ ] 3.6 Make `HEAD` read at most the first batch, send no body and not take an export slot
- [ ] 3.7 Unit tests through `app.inject()` with stub repositories: header stable across filters, empty result, paging and `Link`, unbounded multi-batch order with no repeats, cap and release, disconnect, mid-stream abort, errors staying JSON, and `?format=csv` being a 400

## 4. Description and docs

- [ ] 4.1 Describe `text/csv` on the four list operations (`listRouteSchema`), state the no-`limit` rule, and keep `application/json` as is; extend `test/openapi.test.js` and confirm `test/published.js` still finds each JSON schema
- [ ] 4.2 Document CSV for clients: the `Accept` header with the R `url(..., headers=)` and pandas `storage_options` forms, the flattening rules, escaping, the Excel cell-limit and placeholder-column caveats
- [ ] 4.3 Update `api/CLAUDE.md` (envelope exception, new modules) and add `csv-output` to the API spec list in `openspec/config.yaml`
- [ ] 4.4 Add a `docs/api-design-backlog.md` entry for the deferred items: URL format parameter (`?format=`), TSV, classification columns, single-record CSV, and RIS for `references` (list and single read). For RIS, record its open questions: the `TY` mapping per publication type, author formatting (Classic writes `Bone,D.A.`), whether to write Classic's preamble lines, and whether `ID` holds the permid

## 5. Verification

- [ ] 5.1 Run `npm test` and `npm run test:integration`; add integration coverage that a multi-batch CSV export of each of the four resources matches its JSON pages record for record by `permid`
- [ ] 5.2 On localhost, stream each full list and parse it with an independent CSV reader, checking the row count against the current-head counts and that memory stays flat during the taxa export
- [ ] 5.3 Time the full `taxa` export against Aurora (on the VPN, `PG_*` overridden on the command line), record the result in the design, and revisit the `MAX_CONCURRENT_EXPORTS` default
- [ ] 5.4 Confirm the rollback path: with the `csv` option removed from the routes, `Accept: text/csv` on a list is answered as 406, and JSON reads are unchanged
