## Why

Authorities and collections read through their payload sources. Every reference link they return
(`{ permid, title, href }`) points at `/api/v1/references/{permid}`, and that endpoint still returns
`{ permid, ...payload }` as stored, checked against no schema. A client following a link lands on
the one representation with no contract. References are also the cheapest resource left to move:
`referenceSource` has no `x-link` properties, no child tables and no codecs, so nothing here
depends on the committee's answer about the reference model, which blocks schemas, or on the
undesigned specimen fields.

## What Changes

- **Reference reads go through `merge()`.** GET `/references`, `/references/{permid}` and `?ids=`
  return `merge(referenceSource, { jsonb, columns }, ctx)`, validated against the reference `out`
  variant. `permid` comes from its column.
  - The source declares no codecs, so a page costs one query, as it does today. No codec context is
    loaded.
- **The response doesn't change for stored data.** On localhost, all 93,946 reference heads merge
  and validate against `out` with no errors, and every stored jsonb key is a declared source field.
  So the merged record holds the same keys and values as today's `{ permid, ...payload }`. What's
  new is the guarantee: a contract test now checks the shape.
  - `out` requires only `publicationType` and `publicationYear`. The per-type field rules and the
    `title` requirement live in `x-create`, which `out` leaves out. So the legacy refs whose fields
    their type would no longer allow, and the 541 refs with no title, still validate.
- **The `publication_type` filter is unchanged.** It still matches `reference->>'publicationType'`.
- **The stub takes the source's shape.** The stub is the hand-written record served only when no
  database is configured. It uses `year`, a key the source doesn't have; stored references, and so
  the live route, already use `publicationYear`. The stub changes to `publicationYear`, so it
  validates against `out` like the authority and collection stubs.
- **Unchanged:**
  - `LINK_TARGETS.references`: schemas still use it for their descriptor links, and the codecs read
    the same `refs` title;
  - schemas, specimens and taxa;
  - the envelope;
  - the reference data and the migrations.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `data-access`:
  - `references` joins `authorities` and `collections` as a source-backed resource. Its descriptor
    names `source: referenceSource` and no `children`;
  - reference responses (single, list, `ids`, stub) validate against the reference `out` variant,
    with contract tests that cover a titled reference, an untitled one, and at least two
    publication types.

## Impact

- **Code:**
  - `api/src/lib/resource-tables.js`: `references` gains `source` and keeps its `filters`;
  - `api/src/routes/api/v1/references/index.js`: passes `source`; the stub is fixed;
  - `api/test/`: the source-read contract tests cover references.
  - Nothing in `payloadSchemas/` changes.
- **API clients:** no change for stored data. With no database configured, the stub's `year`
  becomes `publicationYear`.
- **Data integrity:** none. The change is read-only and touches no stored rows.
- **Load:** unchanged, one query per page. With no codecs, the codec-context step makes no queries.
- **What's left after this:** only `schemas` read the old way, through descriptor `links` and
  `{ permid, ...payload }`, and `specimens` is still a stub. Once schemas move, the old read path
  and the descriptor `links` on non-taxa resources can be deleted.
