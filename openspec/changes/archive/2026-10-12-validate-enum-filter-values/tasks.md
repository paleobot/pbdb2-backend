## 1. Attach legal values to filters

- [x] 1.1 In `api/src/lib/repository.js` (`makeReadRepository`), when a `source` is given, expose each declared filter with `values: [...enum]` taken from `source.properties[def.jsonPath].enum` when that is an array; leave other filters as declared (design D1)
- [x] 1.2 Unit test: the `references` repository's `filters.publication_type.values` equals `referenceSource.properties.publicationType.enum`, in order; a repository with no source exposes its filters unchanged

## 2. Reject values outside the enum

- [x] 2.1 In `api/src/lib/list-filters.js` (`collectListFilters`), after the empty-value check, throw `badRequest` with "`<param>` must be one of: <values joined by ', '>" when `def.values` exists and does not include the trimmed value; update the "lenient — see provisional note" comment and the function's doc comment (D2)
- [x] 2.2 In `api/test/field-filters.test.js`, change the `book` fixtures and URLs to `standalone book` (`standalone%20book` in URLs) (D4)
- [x] 2.3 In the same file, turn the `guidebook` test into the 400 test (status, standard error shape, message names `publication_type` and includes `standalone book`), and add: `?ids=…&publication_type=book` is a 400; a legal value with no matching heads (`unpublished`) is an empty 200 with no `meta.missing`
- [x] 2.4 In `api/test/pagination.test.js`, change the `book` fixtures and URLs to `standalone book`, including the `links.next` assertion that the filter survives (match the encoded form)
- [x] 2.5 Run `npm test` from the root and `npm run test:integration`; confirm both pass

## 3. Documentation

- [x] 3.1 Update `api/CLAUDE.md` ("Strict query params"): filter values are validated against the source's enum when the field has one, and are otherwise opaque

## 4. Check against localhost

- [x] 4.1 Against localhost `pbdb`: `?publication_type=book` is a 400 listing the seven types; `?publication_type=standalone%20book` returns the same records as before this change; `?publication_type=unpublished` returns 200
