## Context

`api/docs/response-contracts.md` sets out the problem and chooses design A (§6): links live inside
the payload, are declared in the source, and the `out` variant is the GET contract. This change
builds design A for authorities only.

**What exists:**

```
payloadSchemas/                                 api/
  authority.schema.js                             resource-tables.js
    reference: string permid                        authorities.links.reference
      x-storage { column: reference_id,               → LINK_TARGETS.references (refs, reference->>'title')
                  codec: referencePermid }        repository.js
  lib/codecs.js  referencePermid                    SELECT permid, authority AS payload,
    merge: reference_id → permid string               (SELECT json_build_object('title', …, 'permid', …)
    REFS_SOURCE { refs, id → permid, versioned }        FROM refs r WHERE r.id = reference_id
  lib/storage.js loadCodecContext                        AND NOT removed) AS reference
    heads only (succeeded_by_id IS NULL)            toResource: { permid, ...payload, reference }
  lib/variants.js readOnly root-only              link-hydration.js: href from descriptor.links
```

**Facts this design relies on** (localhost `pbdb`, 2026-10-06):
- `authorities.reference_id` is `bigint REFERENCES refs(id) NOT NULL`. The swing trigger keeps it on
  the reference's current head: 0 authority heads cite a superseded ref.
- 0 reference heads are soft-removed, so 0 authorities cite a removed reference. The case has to
  work, but no data exercises it.
- 542 reference heads have no `title`.
- `persons` is not versioned and has no `removed` column. `refs` has both.
- 163,067 authority heads.

## Goals / Non-Goals

**Goals:**
- Every authority GET (single, list and `ids`) is `merge()` output plus `href` values, and it
  validates against the authority `out` variant. A test proves it.
- Make the annotations (nested `readOnly`, `x-link`) and the codec-context extension (labels,
  removed targets) general enough that collections and schemas need no new mechanism, only their own
  codec work. Build only what authorities use.
- Keep today's response shape for `reference`: `{ title, permid, href }`, or `null` when the target
  is removed.

**Non-Goals:**
- **Collections, schemas, taxa.** They keep `LINK_TARGETS` and the link SQL. `referenceList` gains no
  labels here.
- **Writes and request validation.** That includes the 400 that names a read-only path, and
  stripping nested read-only fields in the PATCH flow (`payloadSchemas/DESIGN_NOTES.md`, "Edit route
  pattern"). This change makes the schemas say what is read-only; enforcing it on writes comes later.
- **Serving variants as JSON Schema over HTTP.**
- **JSON Hyper-Schema templates** (§5 of the doc). `href` stays a plain value.
- **An include parameter.** The stub rules in doc §4 are kept, so it stays additive.

## Decisions

### D1. A link property is declared with a shared helper, and its sub-schema is explicit

`payloadSchemas/lib/links.js` exports `link({ target, label })`. It returns the property schema:

```js
{
  type: 'object',
  properties: {
    permid: { type: 'string', description: 'permid of the linked resource' },
    [label]: { type: 'string', readOnly: true },
    href:    { type: 'string', readOnly: true, description: 'read URL of the linked resource' },
  },
  required: ['permid'],
  additionalProperties: false,
  'x-link': { target, label },
}
```

The authority source declares `reference: { ...link({ target: 'references', label: 'title' }),
'x-storage': { column: 'reference_id', codec: 'referencePermid' } }`.

- **Why explicit and not derived.** The variants derive from what the source says. If `deriveVariant`
  invented `title` and `href` from `x-link`, the source would no longer show the full contract, and
  `x-link` would carry both meaning and schema. The helper keeps every link the same shape while the
  derived schema still shows each field.
- **`additionalProperties: false` on the link object.** The root `unevaluatedProperties: false`
  doesn't reach nested objects. Without this, a create body could carry `title` or anything else
  inside `reference` (see the rename change's design, Non-Goals). The item's read-only fields are
  declared, so `out` still accepts them. In `in-create` they are dropped (D2), so a body that sends
  them fails.
- **The label is optional**, because 542 references have none. The stub then reads
  `{ permid, href }`.
- **No `format: uri-reference` on `href`.** The shared ajv factory doesn't load `ajv-formats`, and
  strict mode rejects unknown formats. The description says what it is.
- **`x-link.target` is the target's route-group name** (`references`). It is the only value the API
  needs to build `href`. The storage layer reads it only to pass it through. The table to read
  labels from comes from the codec's source, not from `x-link` (D3).

Alternative considered: put `title`/`href` in the source by hand at each link. Rejected because
every link would repeat the same eight lines, and they could drift apart.

### D2. `readOnly` is allowed at any depth

- `assertRootOnlyReadOnly` goes away. `transform` already drops `readOnly` properties wherever it
  meets them when deriving `in-create`. The check was the only thing confining that to the root.
- `out` and `db` keep nested `readOnly` fields. `db` drops `reference` entirely anyway, because it
  is `x-storage`.
- `patch-guard` still screens root keys only. A nested read-only field in a PATCH body is not caught
  by validating the merged document: the flow removes read-only fields before that check, so such a
  patch would be silently dropped. The write path needs its own screen, for example a guard that
  walks nested `readOnly` paths. That is out of scope here and listed under Open Questions.

### D3. The codec context can carry labels and the removed set

`loadCodecContext` keeps building `{ byKey, byValue }` per table. Two optional additions sit beside
them, filled from the same read:

- **`labels: Map<key, { <label>: value }>`.** Loaded when a source asks for a label. The source gains an optional
  `payload` (its jsonb column) in the codec, and `collectCodecSources` adds `labels: [<label>]`
  from each `x-link` property it visits. Sources that dedup to the same table merge their label
  lists. `REFS_SOURCE` becomes
  `{ table: 'refs', key: 'id', value: 'permid', versioned: true, payload: 'reference' }`. A label is
  selected as `"<payload>"->>'<label>'`, with the label checked against the same identifier pattern
  as table and column names.
- **`removed: Set<key>`.** For a `versioned` source, heads are still read without excluding
  `removed`, and the keys of removed heads are collected into this set. `byKey`/`byValue` still hold
  every head. A codec that ignores `removed` behaves exactly as today: `referenceList` and its
  zero-difference audit are unaffected.

Why mark removed heads instead of excluding them: excluding them would make `referenceList` and the
audit throw on a collection citing a removed reference. Collections and schemas get their
removed-target behaviour in their own change. For authorities, the codec decides (D4).

`checkSource` accepts the new optional keys (`payload`, `labels`). Unlike `table`, `key` and `value`,
they don't take part in the dedup key, so two codecs reading `refs` share one read.

### D4. `referencePermid` emits and accepts the link object

- **merge.** It receives the property's `x-link` as `storage.link`: `mergeNode` passes
  `{ ...storage, link: prop['x-link'] }` for a single-property codec group. With the stored
  `reference_id`:
  - a removed head gives `reference: null`;
  - otherwise it gives `{ permid, [label]: labels.get(id) }`, leaving out the label key when the
    label is missing;
  - an id that isn't a head at all still throws `referencePermid: refs.id has no entry for …`.
- **split.** It reads `reference.permid` and ignores every other key. Validation has already
  rejected read-only keys in a body, and the audit round trip hands split a merged document that
  still carries `title`. A permid that names a removed reference throws, because a write must not
  cite a removed reference. No route writes yet, but the audit would surface it.
- **The string form goes.** Authority is the codec's only user. Keeping a second output shape would
  serve a caller that doesn't exist.

**Why `null` on removal and not a stub without `href`:** it's what `reference-enrichment` specifies
and what the API returns today. The invariant "no `href` points at a suppressed resource" holds
trivially. `out` must allow it, so `deriveVariant` makes an `x-link` property `type: ['object',
'null']` in `out` only. `in-create` and `db` don't allow `null`.

**Why an unresolvable id throws rather than nulls:** with a NOT NULL foreign key and the swing
trigger, a non-head `reference_id` is an integrity failure, not a data state. A 500 that names it is
correct and is what the audit already expects. This limits the risk the proposal flagged to
corrupt data.

### D5. The repository reads through `merge()` when a resource has a payload source

- A descriptor gains `source` (`authoritySource` for authorities) and drops `links` for that
  resource.
- With a `source`, `makeReadRepository`:
  1. selects `permid`, the payload, and every root `x-storage` column of the source. That's
     `reference_id` for authorities. The list comes from a new `storageColumns(source)` in
     `payloadSchemas/lib/storage.js`, a sibling of `codecKeyColumns`.
  2. runs the head query exactly as today, with the same filters, keyset and `ids` path.
  3. loads one codec context for the page: `collectCodecSources(source)`, with selection from
     `codecKeyColumns` (`refs` restricted to the page's `reference_id`s). A single read is a page of
     one.
  4. builds each record with `merge(source, { jsonb: row.payload, columns: row }, ctx)`.
- **Two queries per request** instead of one with sub-selects. Batched lookups are what
  `selection` was built for, and the second query is one index scan on `refs.id`.
- **Without a `source`,** the repository is unchanged. References, collections, schemas and
  specimens still read `{ permid, ...payload }` with `linkProjections`.

Alternative considered: keep the SQL sub-select for the label and call `merge()` only for the rest.
Rejected because the codec would then not be the one place that resolves `reference_id`, and the
audit and the API would read links two different ways.

### D6. `href` is added at the boundary, driven by `x-link`

- `link-hydration.js` gains `hydrateSourceLinks(record, source, prefix)`. For each root property of
  the source carrying `x-link` whose value is a non-null object with a `permid`, it sets
  `href = groupBase(prefix, target)/permid`.
- `registerCrudRoutes` takes `source` and uses it in place of `links` when present.
- Root properties only. `references[]` arrays arrive with collections, which will extend this to
  `items` then.
- The persistence layer still emits no URL, as `reference-enrichment` requires.
- `href` stays a root-relative path (`/api/v1/references/{permid}`), like `links.self`. Full URLs
  are a later API-wide change (backlog, "Full URLs in links"). `groupBase()` is the one place where
  the base is decided, so that change edits one function.

### D7. Contract tests validate responses against `out`

- **Unit tests (`api/test/`, fake pg):** single, list and `ids` authority responses, plus the stub,
  each validated against `deriveVariant(authoritySource, 'out')` compiled with `createAjv()`. Cases:
  - a reference with a title;
  - a reference without a title;
  - a removed reference, giving `null`.
- **Integration (`api/test/integration/`):** a fixture authority citing a fixture reference, read
  through the real DDL, with the response validated against the same schema. The removed-reference
  case is also covered here, because it can't be exercised on localhost data.
- The API imports from `payloadSchemas/`. That's allowed: only `migrations/` is off limits
  (`repository-layout`). `ajv` resolves from the root `node_modules`, where `payloadSchemas/`
  already gets it.

### D8. The authority stub has the source's shape

`{ permid, legacyIDs: { oldpbdbIDs: [] }, citation: 'Stub authority', descriptors: [],
publishedInReference: false, reference: { permid: 'ref-00000000', title: 'Stub reference' } }`,
then hydrated. It passes the same contract test. `taxonName` and `rank` go away: they were never
authority fields.

### D9. The payload audit follows the codec

`migrations/src/audit-payloads.js` keeps calling `collectCodecSources` and `loadCodecContext`, so
labels and removed sets load without code changes. Its round trip strips root read-only keys, then
splits. Split ignores the nested `title` (D4), so the round trip still matches. Re-run it on
authorities on localhost: 163,067 heads, expecting 0 violations and 0 differences.

## Risks / Trade-offs

- **[A reference edited between the two queries]** The page query and the label query aren't in
  one transaction, so a label could be one version newer than the page.
  → Harmless: `permid` is stable and the label is always a current title. The pool doesn't promise
  snapshot reads across requests today either.
- **[`type: ['object','null']` in `out` only]** A client building forms from `out` sees `null` as a
  possible value of `reference`, which a create never accepts.
  → That is the truth of the read contract. `in-create` describes the write.
- **[A codec receives `storage.link`]** This widens the codec interface slightly.
  → It is optional. Codecs that ignore it are untouched, and only single-property codec groups get
  it.
- **[Behaviour change for the 542 untitled references]** Today the SQL emits `title: null`. After
  this change the key is left out.
  → `title` is optional in `out`. Clients that test `title == null` see no difference in JS. Note it
  in the reference-enrichment delta.
- **[The audit shape for authorities]** `validateOut` now validates the link object, which needs the
  label loaded.
  → Labels load through `collectCodecSources` automatically (D9), and the localhost re-run proves
  it.

## Migration Plan

- No data migration: `authorities.reference_id` and the jsonb are unchanged.
- Deploy is an ordinary API release.
- API clients see `reference` without `title: null` for the untitled references, and everything else
  the same.
- Roll back by reverting the commit.

## Open Questions

- **The write path:** how a PATCH body touching a nested read-only field (`reference.title`) is
  rejected rather than silently dropped. Also which variant validates a merged PATCH document. That
  second question is already in the backlog ("Which variant validates a merged PATCH document"). This is already in the backlog ("Which variant validates a merged PATCH
  document").
- **Collections and schemas:** what an omitted removed reference does to the `referenceList` round
  trip. Settle it in their change.
