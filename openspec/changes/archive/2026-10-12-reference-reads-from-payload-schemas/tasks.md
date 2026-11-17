## 1. Read references through the source

- [x] 1.1 In `api/src/lib/resource-tables.js`, import `referenceSource` and give the `references` descriptor `source: referenceSource`, keeping its `filters` (design D1, D3)
- [x] 1.2 In `api/src/routes/api/v1/references/index.js`, pass `source: descriptorFor('references').source` and change the stub to `{ permid, publicationType: 'journal article', title: 'Stub reference', publicationYear: '2026' }` (D2)
- [x] 1.3 Run `npm test -w api` and confirm the existing reference fixtures in `repository.test.js`, `pagination.test.js`, `field-filters.test.js` and `multi-get.test.js` pass unchanged (D4)

## 2. Contract tests

- [x] 2.1 In `api/test/source-reads.test.js`, add reference cases validated against `deriveVariant(referenceSource, 'out')`: a single read; a list with a titled reference, an untitled one and two publication types; an `ids` read; the stub with no database (D5)
- [x] 2.2 In the same file, assert that a reference single read and a reference page each issue exactly one query
- [x] 2.3 In `api/test/integration/reads.test.js`, add a test that reads a titled reference and an untitled one over real PostgreSQL, singly and as a list, and validates each against the reference `out` variant, with `permid` from the column
- [x] 2.4 Run `npm run test:integration` and confirm it passes

## 3. Documentation

- [x] 3.1 Update `api/CLAUDE.md` ("Reads through a payload source"): `authorities`, `collections` and `references` read this way, and only `schemas` and `taxa` keep descriptor `links`
- [x] 3.2 Update the header comment of `api/src/lib/repository.js` if it lists the source-backed resources, and the "Since then" note in `api/docs/response-contracts.md` to mention references

## 4. Check against localhost

- [x] 4.1 Start the API against localhost `pbdb`, read a sample of references (single, list, `?publication_type=book`, `?ids=`), and confirm the bodies match the pre-change `{ permid, ...payload }` responses key for key
