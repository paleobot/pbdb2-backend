## Why

`GET /references?publication_type=book` answers 200 with an empty list. `book` is not a
publication type: the closed set is `journal article`, `standalone book`, `edited collection`,
`article in edited collection`, `serial monograph`, `unpublished` and `other`. Clients can't tell
that empty list apart from a real "no references of this type". That is the silently wrong
response that made unknown query parameters a 400 ("Strict query-param handling").

The spec kept filter values opaque on purpose, but provisionally: "pending integration of the
`pbdb2-dev` JSON Schemas, which would supply the value enums". As of
`reference-reads-from-payload-schemas` (2026-10-12), that condition is met. The `references`
descriptor names `referenceSource`, and the source's `publicationType` is an enum generated from
`PUBLICATION_TYPES`.

## What Changes

- **A filter value outside its field's enum is a 400.** When a declared field filter's `jsonPath`
  names a property of the resource's payload source that has an `enum`, a value outside that enum
  SHALL be rejected with HTTP 400 in the standard error shape. The message names the parameter
  and lists the allowed values. **BREAKING** for a client sending an illegal value: it gets a 400
  where it used to get an empty 200.
- **Values in the enum are unchanged.** A legal value that no current head has, for example
  `unpublished` if none exists, still yields 200 with an empty `data`.
- **Filters on fields without an enum stay opaque.** That covers a field with no enum, or a
  resource with no source. Today `publication_type` is the only declared field filter, so in
  practice the change covers that one filter.
- **No stored row is hidden.** All 93,946 localhost reference heads validate against the
  reference `out` variant, which enforces the enum. So a value outside the enum could never have
  matched anything.
- **Test fixtures that use `book` change to `standalone book`.** These are in
  `api/test/field-filters.test.js` and `api/test/pagination.test.js`. The test that checks
  `publication_type=guidebook` gives an empty 200 now asserts a 400.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `resource-routes`:
  - "Per-entity field filters": a value outside the field's enum is a 400. The "no match"
    scenario is limited to legal values.
  - "Strict query-param handling": the paragraph saying filter values are opaque, and its
    scenario, are replaced. Values are validated when the source supplies an enum, and are opaque
    otherwise.

## Impact

- **Code:**
  - `api/src/lib/list-filters.js`: the `validate` stage checks a value against its allowed
    values;
  - `api/src/lib/crud-routes.js` or the descriptor: something must give each filter its enum,
    taken from the source property its `jsonPath` names;
  - tests in `api/test/`.
  - Nothing in `payloadSchemas/` changes.
- **API clients:** an illegal `publication_type` is now a 400 that lists the legal values. Legal
  values behave as before.
- **Data integrity:** none. The change is read-only.
- **Deferred:** deriving the filters themselves from the source (D3 of
  `reference-reads-from-payload-schemas`), and enum fields that come from dictionary tables
  (`x-enumFrom`). The one filter today uses a literal enum. Both wait for a filter that needs them.
