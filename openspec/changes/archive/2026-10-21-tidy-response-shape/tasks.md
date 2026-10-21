## 1. Envelope (`api/src/plugins/envelope.js`)

- [x] 1.1 `sendData`: `meta` is `{ type, ...meta }` with no `removed` and no `version`; update the
      doc comment, which still says it reserves `meta.version` and the relationship `links` slots
      "before DB integration"
- [x] 1.2 `sendList`: `meta` is `{ returned, ...meta }` with no `found`; update the doc comment
- [x] 1.3 `test/envelope.test.js`: assert a single read's `meta` is exactly `{ type }` and its
      `links` exactly `{ self }`, and that a list's `meta` has `returned` and no `found`

## 2. Filter name (`api/src/lib/resource-tables.js`)

- [x] 2.1 Rename the `references` filter key `publication_type` → `publicationType` (its `jsonPath`
      stays `publicationType`); check the descriptor comments and `list-filters.js` for the old
      name or the "snake_case-param" wording
- [x] 2.2 `test/field-filters.test.js` and `test/pagination.test.js`: send `publicationType`, assert
      messages name `publicationType`, and expect `links.next` to carry `publicationType=`
- [x] 2.3 Add the scenario "The former snake_case name is unrecognized": `?publication_type=` with a
      legal value → 400 naming `publication_type` and listing `publicationType` as accepted
- [x] 2.4 `test/repository.test.js`: `repo.filters.publicationType` carries the source's enum

## 3. Remaining test assertions

- [x] 3.1 `meta.found` → `meta.returned` in `test/pagination.test.js`, `test/repository.test.js`,
      `test/multi-get.test.js` and `test/field-filters.test.js`; the multi-get tests also assert
      `meta` has no `found`
- [x] 3.2 `test/taxa.test.js`: a taxon single read's `meta` is exactly `{ type: 'taxon' }` (it
      currently asserts `removed: false` and the null `version`)
- [x] 3.3 Search `api/test` (unit and integration) for any other `found`, `removed` or `version`
      assertion on `meta`, and for `publication_type`; none may remain except the 2.3 scenario

## 4. Docs

- [x] 4.1 `api/docs/api-response-envelope-comparison.md` §2: remove `found`, `removed` and the
      populated `version` from the examples; add one sentence saying relationships moved inline
      (decision A in `response-contracts.md`) and that version fields await `/versions`. The
      `data1.2` comparison stays as written
- [x] 4.2 `docs/api-design-backlog.md`: add an entry for the `/versions` sub-resource, recording
      that versions share their lineage's `permid` and a public version identifier must be designed
      before `meta.version` can return
- [x] 4.3 Check `api/CLAUDE.md` and `api/docs/response-contracts.md` for the old field and parameter
      names (none found at planning time; confirm after the code changes)

## 5. Verify

- [x] 5.1 `npm test` passes from the repository root
- [x] 5.2 `npm run test:integration` passes
- [x] 5.3 Against the localhost server: `GET /api/v1/references?publicationType=standalone%20book&limit=2`
      returns matches with `meta` = `{ returned, type }`; a single read and a taxon single read have
      `meta` = `{ type }`; `?publication_type=` is a 400 naming it
- [x] 5.4 `openspec validate tidy-response-shape` passes
