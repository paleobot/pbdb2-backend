## Why

In the collection and schema sources, a `references[]` item names the cited reference's id
`referenceID`. Everywhere else in PBDB2 a resource's id is `permid`: every resource's own id, and the
API's link objects (`{ title, permid, href }`). Design A (`api/docs/response-contracts.md` §4) makes
the payload sources the API's response contract, and its stub rule says a link object uses the
target's own field names. So the name has to be `permid` before `api-reads-from-payload-schemas`
builds on it. Left alone, the inconsistency would spread to every link the sources declare.

## What Changes

- **BREAKING (source contract):** in `collection.schema.js` and `schema.schema.js`, `references[]`
  items become `{ permid, order }` (were `{ referenceID, order }`), with both required as before.
  This applies to every variant derived from those sources: `out`, `in-create` and `patch-guard`.
  `db` does not declare `references`, because it is `x-storage`.
- The `referenceList` codec reads `permid` from each item on split and writes `permid` on merge.
  Ordering, primary/additional placement and heads-only resolution are unchanged.
- Tests in `payloadSchemas/tests/` follow the rename.

Nothing else is renamed. The authority source's scalar `reference` and the `referencePermid` codec
are reshaped by `api-reads-from-payload-schemas`, not here.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `payload-schema-variants`: the `referenceList` codec requirement and the schema source's property
  table name the item key `permid` instead of `referenceID`, including their scenarios.

## Impact

- **Code:** `payloadSchemas/collection.schema.js`, `payloadSchemas/schema.schema.js`,
  `payloadSchemas/lib/codecs.js` (`referenceList`), and `payloadSchemas/tests/`
  (`sources.test.js`, `storage.test.js`).
- **API:** none. The API doesn't use the sources yet, and its link objects already say `permid`.
- **Migrations:** none of the migration scripts name `referenceID`. `migrations/src/audit-payloads.js`
  merges and splits collections and schemas through `referenceList` in its round-trip check, so it
  goes through the renamed codec with no code change. Re-running the audit on collections and schemas
  on localhost confirms the round trip still matches.
- **Data integrity:** none at rest. `references[]` is stored in `collections.reference_id`,
  `schemas.reference_id` and the `additional_*_refs` join tables, never in the jsonb: on localhost no
  collection or schema payload contains `referenceID`. The only failure mode is a missed rename, which
  would make split or merge drop or reject references. The audit round trip and the codec tests catch
  that.
- **Outside this repository:** the hand-written `collections.schema.js` (2026-03) predates the
  monorepo. Any external copy of it, for example in a frontend, would need the same rename.
- **Docs:** `api/docs/response-contracts.md` §4 already records the decision.
