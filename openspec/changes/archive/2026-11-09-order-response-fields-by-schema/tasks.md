## 1. Merge order

- [x] 1.1 In `payloadSchemas/lib/storage.js`, make `mergeNode` return its output with declared properties in `schema.properties` order and undeclared keys after, keeping its existing `undefined` result for an absent, empty node
- [x] 1.2 Add tests to `payloadSchemas/tests/storage.test.js`: declared order with a column-backed field, an undeclared key kept after the declared ones, and a declared nested object ordered

## 2. Schema order

- [x] 2.1 Move `legacyIDs` to the last property in the reference, authority, collection, schema, character, state, specimen and person schemas
- [x] 2.2 Reorder `payloadSchemas/reference.schema.js` to start `permid, title, publicationType`, move `title` directly after `permid` in `payloadSchemas/schema.schema.js`, and move `citation` directly after `permid` in `payloadSchemas/authority.schema.js`
- [x] 2.3 Update the `Object.keys` order assertions in `payloadSchemas/tests/sources.test.js` and any others the move affects

## 3. Taxa links

- [x] 3.1 Swap the arguments in both `json_build_object` forms in `labelObject` (`api/src/lib/repository.js`) so `permid` comes before the label
- [x] 3.2 Update the SQL assertions in `api/test/link-enrichment.test.js` to the new argument order

## 4. Response order tests

- [x] 4.1 Add assertions in `api/test/source-reads.test.js` (or alongside it) that each resource's record has `permid` first, `name` or `title` second where declared (`citation` on an authority), and `legacyIDs` after the other payload fields, single and list
- [x] 4.2 Add an assertion that characters and states in a schema tree have `permid` first
- [x] 4.3 Add an assertion that a taxon's `authority` and `accepted` links are `permid`, label, `href` in that order

## 5. Verification

- [x] 5.1 Run `npm test` and `npm run test:integration`
- [x] 5.2 Run the payload audit with `--round-trip` on localhost and confirm no new differences
- [x] 5.3 Read each resource from the local API and confirm the order, including that `/api/v1/openapi.json` components list `permid` first and `legacyIDs` last
- [x] 5.4 Update `api/CLAUDE.md` if its description of reads needs the ordering noted
