## Context

Field filters are declared per resource in `api/src/lib/resource-tables.js` as
`{ param: { jsonPath, op } }`. Today the only one is `references.publication_type → publicationType`.
`makeReadRepository` exposes them as `repository.filters`. `listReadHandler` (`crud-routes.js`)
passes them to `collectListFilters` (`list-filters.js`), which:
- rejects unknown parameters;
- rejects an empty value;
- otherwise accepts any string.

The repository then translates the filter to `payload->>'<jsonPath>' = $n`.

Since `reference-reads-from-payload-schemas`, the `references` descriptor also names
`source: referenceSource`. There, `properties.publicationType.enum` is
`Object.keys(PUBLICATION_TYPES)`, a literal array of seven values. All 93,946 localhost heads
validate against `out`, which enforces that enum.

With no database there is no repository, so there are no declared filters. A
`publication_type` param is then already a 400 as an unknown parameter, so the stub path is
unaffected.

## Goals / Non-Goals

**Goals:**
- A declared field filter whose field has an `enum` in the resource's source rejects values
  outside it with a 400. The message names the parameter and lists the allowed values.
- Legal values, and filters on fields without an enum, behave exactly as before.

**Non-Goals:**
- Deriving the filter declarations themselves from the source (which properties are filterable,
  and under what parameter names).
- Enums that come from dictionary tables (`x-enumFrom`). Those need a database read to resolve,
  and no filter uses one. Such a filter stays opaque until one is declared.
- Case-insensitive or prefix matching. The comparison is exact, as the SQL predicate is.
- Validating `ids` or cursor values. They are already handled.

## Decisions

### D1. The allowed values are attached to the filter when the repository is built

`makeReadRepository` already receives both `filters` and `source`. For each declared filter it
looks up `source.properties[def.jsonPath]`. If that property has an array `enum`, the exposed
definition gains `values: [...enum]`. The repository exposes these enriched definitions as
`repository.filters`. This happens once per repository, when the routes are registered, not on
each request.

*Alternatives:*
- Look the values up in `collectListFilters` on each request. Rejected: the seam would need the
  source passed in, which spreads payload-schema knowledge into a module that only parses query
  strings.
- Write `values` by hand in the descriptor. Rejected: it duplicates `PUBLICATION_TYPES`, and the
  two lists would drift.
- Enrich in `descriptorFor`. Rejected: descriptors are static data, and this would make lookups
  return something other than the stored object.

### D2. `collectListFilters` checks `values` when present

After the empty-value check: if `def.values` exists and does not include the trimmed value, throw
`httpErrors.badRequest` with the message:

```
`publication_type` must be one of: journal article, standalone book, edited collection, …
```

The values are listed in enum order. A definition without `values` is unchanged. The check runs
for list and `ids` reads alike, because both go through the same seam.

### D3. An illegal value is a 400, not an empty 200 with a warning

This was decided by the user, and it matches "Strict query-param handling": a response that looks
correct but isn't is worse than an error. Because `out` enforces the enum on every stored head, a
value outside it can't match anything, so the 400 hides no data.

### D4. Fixtures move to legal values

The `book` fixtures in `field-filters.test.js` and `pagination.test.js` become `standalone book`,
URL-encoded `standalone%20book` in request URLs. The `guidebook` test asserted the old leniency.
It becomes the 400 test: status, standard error shape, the parameter name, and a legal value
(`standalone book`) appearing in the message. A new test checks that a legal value with no
matching heads (`unpublished`, absent from the fixtures) still yields an empty 200.

## Risks / Trade-offs

- **[A client relying on the empty 200]** It now gets a 400. → This is the intended break, and the
  message tells the client which values are legal. The API has no external clients yet.
- **[Source enum changes]** Adding a publication type to `PUBLICATION_TYPES` widens the filter
  automatically. Removing one makes that value a 400, even if stored rows still hold it. → The
  `db`-variant audit (`migrations/src/audit-payloads.js`) would flag those rows first, and a
  removal would be its own change.
- **[A filter whose jsonPath names no source property]** It gets no `values` and stays opaque. →
  That's acceptable for now. A unit test pins `references.publication_type` to the enum, so a
  renamed property or mistyped `jsonPath` fails loudly.
- **Data integrity:** none. The change only affects request validation.

## Migration Plan

Deploy with the API. Rollback is reverting the change. Nothing is stored.

## Open Questions

None.
