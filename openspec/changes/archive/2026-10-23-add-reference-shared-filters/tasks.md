## 1. Database

- [x] 1.1 Add `CREATE EXTENSION IF NOT EXISTS unaccent;` beside `postgis` in `db/02-core.sql`, with a comment naming its user (the API's text filters)
- [x] 1.2 Run the ddl-layout guard (`db/tests/`), and update it if it lists extensions per file
- [x] 1.3 Create the extension on localhost `pbdb` (`CREATE EXTENSION IF NOT EXISTS unaccent;`) and confirm that `SELECT unaccent('Schröder')` returns `Schroder`
- [x] 1.4 Create the extension on Aurora `pbdb2_migration_test` and confirm it the same way (`unaccent` 1.1 is available there; the VM must be on the VPN)

## 2. Match kinds

- [x] 2.1 Create `api/src/lib/field-filter-ops.js` with `FIELD_FILTER_OPS`: one entry per kind (`eq`, `doi`, `allWords`, `familyNames`, `firstFamilyName`, `yearRange`), each with `schema`, `describe(jsonPath)`, `parse(value, httpErrors)` and `predicate(payload, jsonPath, bind)` (design D1)
- [x] 2.2 `eq`: move today's behaviour into the entry unchanged (the enum is still added by `listQuerySchema`; same description; raw value; `->>'<jsonPath>' = $n`)
- [x] 2.3 `doi`: one prefix pattern shared by the JS normalizer and the SQL `regexp_replace`; `parse` strips the prefix and lowercases, and a value left empty is a 400 (D2)
- [x] 2.4 `allWords`: `parse` splits on whitespace and de-duplicates; the predicate escapes `\`, `%`, `_` as it binds, and is one `unaccent(...) ILIKE '%' || unaccent($n) || '%'` per word, joined with `AND` (D3)
- [x] 2.5 `familyNames`: `parse` splits on commas, trims and de-duplicates, and an empty item is a 400 naming the parameter; the predicate is one `EXISTS (… jsonb_array_elements …)` per name, joined with `AND` (D4)
- [x] 2.6 `firstFamilyName`: a comma is a 400 saying one family name only; the predicate matches `->'authors'->0->>'familyName'` (D5)
- [x] 2.7 `yearRange`: the schema pattern is `^\d{4}(-\d{4})?$`; `parse` returns `{ from, to }`, and `from > to` is a 400 naming the parameter; the predicate is the `CASE`-guarded cast `BETWEEN $a AND $b` (D6)

## 3. Wire the stages

- [x] 3.1 `listQuerySchema` (`query-schemas.js`): take each filter's schema fragment and description from its kind; `eq` keeps the inline-enum lookup
- [x] 3.2 `messageFor`: add a hand-written message for the `publicationYear` pattern error (`` `publicationYear` must be a year (YYYY) or a range (YYYY-YYYY) ``), keyed to the kind and not to the parameter name
- [x] 3.3 `collectListFilters` (`list-filters.js`): run each sent filter's `parse`; `fields` then carries parsed values. Update the module and function doc comments
- [x] 3.4 `readHeads` (`repository.js`): build each field predicate through its kind's `predicate` with a `bind` that pushes onto `values`; update the doc comment's list of contributors
- [x] 3.5 `makeReadRepository`: throw when a declared filter names an unknown `op`
- [x] 3.6 Declare the five filters in the `references` descriptor (`resource-tables.js`) and update the `FieldFilter` typedef's `op`
- [x] 3.7 Update `api/CLAUDE.md` where it describes filters, if it says only equality exists

## 4. Unit tests (`npm test -w api`)

- [x] 4.1 `field-filter-ops` tests: each `parse` (DOI prefixes and case, word splitting and escaping, author splitting with an empty item as a 400, comma in `firstAuthor` as a 400, single year, range, equal ends, reversed range as a 400) and each predicate's SQL shape with bound values
- [x] 4.2 `query-validation` tests: a malformed `publicationYear` (`79`, `1990-`, `1990..2000`) gives the hand-written 400; an empty value for each new parameter is a 400; `enteredBy` is unrecognized
- [x] 4.3 `field-filters` tests: the new parameters reach SQL as bound predicates and compose with `ids` and `publicationType` (the `ids` accounting is suppressed)
- [x] 4.4 `openapi` tests: the references operation lists all nine parameters in order; `publicationYear` carries the pattern; the descriptions state the rules (api-description scenarios)
- [x] 4.5 Repository tests: an unknown `op` throws at build

## 5. Integration tests (`npm run test:integration`)

- [x] 5.1 Fixture references (minted with `newPermid()`) covering: a DOI stored as an `https://doi.org/` URL in mixed case, a duplicate DOI, a title with an accent and one with HTML tags, a title containing `%`, author orders `Reisz, Sues` and `Sues, Reisz`, `Schröder`, `de la Fuente`, years `1989`/`1990`/`2000`/`2001`, a stored year `79`, and a reference with no title or authors
- [x] 5.2 One test per resource-routes scenario in "Reference filters on shared fields", against the real database, including composition across three filters
- [x] 5.3 Responses still validate against the published `Reference` component (`test/published.js`)

## 6. Backlog and checks

- [x] 6.1 `docs/api-design-backlog.md`: record `enteredBy` as parked under "Fields the server supplies" (the four obstacles in design D8; the trigger is a `/persons` read plus the provenance decision); add a line that stored-DOI normalization in the migration is a pending team question; note prefix or particle-aware family-name matching and indexes as possible follow-ups
- [x] 6.2 Run root `npm test` and `npm run test:integration`, and both pass
- [x] 6.3 Smoke test against localhost `pbdb`: `?authors=Sues`, `?doi=https://doi.org/<a known doi>`, `?publicationYear=1990-1995&firstAuthor=Sues`, `?title=triassic archosaur` return plausible counts in about 100 ms or less
- [x] 6.4 With the server running, confirm that `GET /api/v1/openapi.json` lists the five new parameters on `GET /api/v1/references`, with their descriptions and the `publicationYear` pattern, and that `/api/v1/docs` shows them under that operation
