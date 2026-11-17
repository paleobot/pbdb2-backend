## Context

`authority-reads-from-payload-schemas` (ed75cde) and `collection-reads-from-payload-schemas`
(37dbcbc) built the source-backed read path in `api/src/lib/repository.js`. A descriptor that names a
`source` is read with `storageSelects` and `merge()`, plus one codec-context query per codec source
and one query per child table. Its links come from the source's `x-link`s and are hydrated by
`hydrateSourceLinks`, and its responses are contract-tested against `deriveVariant(source, 'out')`
in `api/test/source-reads.test.js`.

`references` is still on the old path, which returns `{ permid, ...payload }`. Its source,
`payloadSchemas/reference.schema.js`, is the simplest one the path has met:

- the only `x-storage` is `permid → column permid`;
- no codecs, so `collectCodecSources` is empty;
- no `x-link`s, so `hydrateSourceLinks` adds nothing;
- no child tables.

Checked on localhost (`pbdb`, 93,946 live heads, none removed) before the proposal:

- every head merged with `merge(referenceSource, { jsonb, columns: { permid } }, {})` validates
  against the `out` variant, with 0 errors;
- the stored keys are all declared source fields: `language`, `publicationYear`,
  `publicationType`, `legacyIDs`, `authors`, `title` (93,404), `pages`, the journal, series and book
  fields, `doi`, `comments`, `publisher`, `publicationCity`, `editors` and `description`;
- `out` has no `if`/`then`, and its `required` is `['publicationType', 'publicationYear']`.

## Goals / Non-Goals

**Goals:**
- `references` reads (single, list, `ids`, stub) go through the source and validate against `out`.
- The `publication_type` filter, keyset pagination and the head filter behave exactly as before.
- Clients see no change for stored data.

**Non-Goals:**
- `schemas`, which wait on the committee's reference-model answer; `specimens`, whose link fields
  are undesigned; `taxa`.
- Deleting the old read path (`toResource`, descriptor `links`, `linkProjections`). `schemas` and
  `taxa` still use it.
- Changing `LINK_TARGETS.references`. Schemas' descriptor links still resolve through it.
- Write routes, request-body validation, and serving `out` to clients.

## Decisions

### D1. Descriptor change only; no new repository code

`references` gains `source: referenceSource` and keeps its `filters`. It declares no `children` and
no `links`. The source path already handles a source with no codecs:
- `storageSelects` yields only `permid`, which the head select already reads;
- `id` is selected only when there are children;
- `loadCodecContext` loops over an empty source list and makes no queries.

So a page is one query, as today.

*Alternative:* skip `merge()` when a source has no codecs, and return the jsonb with `permid`
added. Rejected: that is an optimisation of a step that costs nothing, and a later codec on the
reference source would silently not run.

### D2. The route passes `source`; the stub takes the source's shape

`routes/api/v1/references/index.js` passes `source: descriptorFor('references').source`, as
authorities and collections do, so `registerCrudRoutes` hydrates through `hydrateSourceLinks`, which
adds nothing here. The stub, which is served only when no database is configured, becomes a minimal
`out`-valid record:
`{ permid, publicationType: 'journal article', title: 'Stub reference', publicationYear: '2026' }`.
The current stub's `year` key was never a source field. Stored references, and so the live route,
already use `publicationYear`.

### D3. The filter stays a raw JSONB path

`publication_type` still translates to `reference->>'publicationType' = $n`. The source says the
field is stored in the jsonb under the same name, so the filter and the source agree. Deriving
filters from the source belongs to a general filter design, not to this change.

### D4. Existing reference fixtures stay as they are

`api/test/repository.test.js`, `pagination.test.js`, `field-filters.test.js` and
`multi-get.test.js` use references as the vehicle for fake-pg reads, with payloads such as
`{ title, year }`, a made-up key that no stored reference has. `mergeNode` copies the jsonb and only overwrites storage-backed names, so an
undeclared key passes through. Those tests keep asserting `{ permid, ...payload }` and stay valid
under the new path. They test the repository, not the contract. The new contract tests in
`source-reads.test.js` use `out`-valid fixtures.

*Alternative:* move those tests to another resource, so references fixtures are all `out`-valid.
Rejected: nothing else uses the plain-payload path with filters, and the tests would lose the filter
coverage.

### D5. Contract tests mirror the authority set

`source-reads.test.js` gains reference cases:
- a single read;
- a list containing a titled reference, an untitled one (title is not in `out`'s `required`), and
  two publication types with different fields;
- an `ids` read;
- the stub with no database.

Each validates `data` against the reference `out` variant. The integration suite gains one check:
a reference inserted through the DDL reads back `out`-valid with `permid` from the column.

## Risks / Trade-offs

- **[A stored key outside the source]** `merge()` passes unknown jsonb keys through, so `out` is
  enforced only by tests, not at runtime. This is the same as authorities and collections. →
  `migrations/src/audit-payloads.js` already audits refs against the `db` variant. The localhost
  check above found no such key.
- **[Fixtures that wouldn't satisfy `out`]** D4 keeps fake payloads that `out` would reject. A
  reader could take them as examples of the contract. → They live outside `source-reads.test.js`,
  which is the file the spec points at for the contract.
- **[The stub changes shape]** Only a client running with no database sees it, and that client
  already gets a fiction. → Noted in the proposal.
- **Data integrity:** none at risk. The change is read-only and touches no rows, DDL or migration.

## Migration Plan

Deploy with the API. Rollback is reverting the descriptor and route lines; nothing is stored
differently.

## Open Questions

None blocking. After this, `schemas` is the only version-chained resource that reads the old way,
and moving it waits on the committee.
