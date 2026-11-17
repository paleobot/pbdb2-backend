## 1. Match kind

- [x] 1.1 Add `foldedEq` to `FIELD_FILTER_OPS` in `api/src/lib/field-filter-ops.js`: no schema fragment; `describe` says the whole value must equal, ignoring case, accents and runs of whitespace; `parse` returns the value; the predicate is `lower(unaccent(regexp_replace(<field>, '\s+', ' ', 'g'))) = lower(unaccent(regexp_replace($n, '\s+', ' ', 'g')))` (design D3)

## 2. Descriptor and description

- [x] 2.1 Add an optional `note` to the `FieldFilter` typedef in `resource-tables.js`, and have `listQuerySchema` (`query-schemas.js`) append it to `kind.describe(jsonPath)` (D2)
- [x] 2.2 Add a helper in `resource-tables.js` that lists the publication types allowing a field (its type's `fields` names it, or the type is `unrestricted`), in `PUBLICATION_TYPES` order, as the note's text (for example, "Allowed on journal article and other.")
- [x] 2.3 Declare the six filters in the `references` descriptor: `journalTitle` and `seriesTitle` as `foldedEq`, `bookTitle`, `publisher` and `publicationCity` as `allWords`, `bookType` as `eq`, each with its note; the `bookTitle` note also says it is the containing book of an article in an edited collection, not an edited collection's own title (D4)
- [x] 2.4 Update the descriptor comment (it says "fields every publication type carries") and the field-filter line in `api/CLAUDE.md`

## 3. Unit tests (`npm test -w api`)

- [x] 3.1 `field-filter-ops` tests: `foldedEq` parse and predicate SQL shape with the bound value
- [x] 3.2 Helper test: `journalTitle` → journal article, other; `publisher` → standalone book, edited collection, article in edited collection, serial monograph, other; `bookType` → standalone book, other
- [x] 3.3 `query-validation` tests: an empty value for each new parameter is a 400; `bookType=novel` passes validation (no enum)
- [x] 3.4 `field-filters` tests: the new parameters reach SQL as bound predicates and compose with `publicationType` and `ids`
- [x] 3.5 `openapi` tests: the references operation lists all fifteen parameters; type notes appear on the six new filters and on no shared-field filter; `bookType` has no `enum`; the `journalTitle` description says the whole value must match (api-description scenarios)

## 4. Integration tests (`npm run test:integration`)

- [x] 4.1 Fixtures (minted with `newPermid()`): journals `Palaeontology` and `Journal of Systematic Palaeontology`; `Revue de  Paléobiologie` with a doubled space; series `American Museum Novitates`; publishers `Elsevier` and `Elsevier BV`; city `Washington, D.C.`; an article in edited collection with `bookTitle` `The Dinosauria` and an edited collection titled `The Dinosauria`; book types `Ph.D. thesis` and `monograph`; a journal article with a `publisher`
- [x] 4.2 One test per scenario in the resource-routes requirement "Reference filters on type-specific fields", including the contradiction and the composition with `publicationYear`
- [x] 4.3 Responses still validate against the published `Reference` component (`test/published.js`)

## 5. Checks

- [x] 5.1 Run root `npm test` and `npm run test:integration`; both pass
- [x] 5.2 Smoke test against localhost `pbdb`: `?journalTitle=Palaeontology` returns at least 1,457 (exact-case count; folded variants may add some), `?journalTitle=Journal of Vertebrate Paleontology` at least 2,434, `?bookType=Ph.D. thesis` exactly 262, and `?publisher=elsevier` includes legacy journal articles, each in about 100 ms or less
- [x] 5.3 With the server running, confirm that `GET /api/v1/openapi.json` lists the six new parameters on `GET /api/v1/references` with their notes, and that `/api/v1/docs` shows them
