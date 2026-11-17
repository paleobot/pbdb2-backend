## Context

`references[]` items in `collection.schema.js` and `schema.schema.js` are `{ referenceID, order }`.
The name goes back to the hand-written collection schema (2026-03). The schema conversions and the
`referenceList` codec (2026-09-18) kept it. Every other id in PBDB2 is `permid`, including the API's
link objects. `authority-reads-from-payload-schemas` makes the sources the response contract, so the name
is settled first (`api/docs/response-contracts.md` §4).

Where the name appears today:
- the two sources, which declare the item properties and `required`
- `referenceList` in `payloadSchemas/lib/codecs.js`, which reads it on split and writes it on merge
- `payloadSchemas/tests/storage.test.js` and `sources.test.js`
- the `payload-schema-variants` spec, in the `referenceList` and schema-source requirements

Not in the jsonb at rest: `references` is `x-storage`, kept in `reference_id` columns and
`additional_*_refs` rows. Not in the API, nor in any migration script.

## Goals / Non-Goals

**Goals:**
- Name the item key `permid` in both sources, in the codec and in the spec.
- Keep every variant's behaviour otherwise identical: the same required fields, ordering and
  storage.

**Non-Goals:**
- **Closing reference items.** The item schemas don't set `additionalProperties: false`, and the
  root `unevaluatedProperties: false` doesn't reach into array items. So an item carrying both `permid`
  and a stray `referenceID` validates today and still will after this change. Closing the items
  belongs to `authority-reads-from-payload-schemas`, which adds read-only `title`/`href` to link objects and
  must reject them in bodies.
- **The authority link.** The authority `reference` field and `referencePermid` are reshaped in
  `authority-reads-from-payload-schemas`.
- **Any alias.** Neither the sources nor the codec will accept `referenceID` alongside `permid`.

## Decisions

- **A plain rename, with no transition period.** No route accepts these bodies yet and no stored data
  holds the key, so there's no client to keep working through a deprecation. An alias would leave a
  second name around, which is the thing this change removes.
- **Keep the item's `description`** ("permid of the cited reference"). It already says what the
  value is. The key now matches it.
- **One commit for sources, codec, tests and spec.** The codec and the sources must agree. Renaming
  only one breaks split and merge together, and the tests fail until both have changed.

## Risks / Trade-offs

- **A missed occurrence:** split finds no `permid` on an item, or merge emits an item the source
  rejects.
  → The codec tests cover split and merge for both child tables. `sources.test.js` validates create
  bodies against both sources. A repo-wide grep for `referenceID` (task 2.2) must find only historical
  mentions in docs and the spec text naming the old key.
- **An outside copy of `collections.schema.js`.** A frontend, for example, would still say
  `referenceID`.
  → No such consumer is known in this repository. The proposal names it, and it's noted in
  `api/docs/response-contracts.md` §4.
- **The audit round trip.** `migrations/src/audit-payloads.js` merges and splits collections and
  schemas through the renamed codec.
  → Run the audit on collections and schemas on localhost before and after the rename. The two
  results must match.

## Migration Plan

None. No data is migrated, because the key isn't stored. Roll back by reverting the commit.
