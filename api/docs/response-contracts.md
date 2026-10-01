# PBDB2 API — Response Contracts and Shared Payload Code

**Status:** Exploration (2026-10-01). Nothing decided is implemented yet; no OpenSpec change exists.
**Audience:** PBDB2 backend contributors
**Subject:** How the API starts using `payloadSchemas/`, and where linked-resource conveniences
(`title`, `href`) belong in a GET response

This picks up the backlog entry "API responses vs. the `out` variants"
(`docs/api-design-backlog.md`). It records one discussion: what was found, what was agreed, and
the two designs still in the running.

---

## 1. Where things stand

The monorepo move (2026-10-01) put the API next to the payload schemas, but the API does not use
any of the shared code yet:

```
                     payloadSchemas/lib            api/ today
                     ──────────────────            ──────────
 GET  response   ◀── merge() + codec ctx           {permid, ...jsonb} + own SQL link joins
      contract   ◀── deriveVariant('out')          (none)
 POST body       ◀── in-create + split()           stubbed
 PATCH body      ◀── patch-guard + merge→validate  stubbed
 serve schemas   ◀── resolveEnums + deriveVariant  (none)
 PG connection       three copies: migrations/src/lib/pg-pool.js,
                     payloadSchemas/tests/pg.js, api/src/config.js
```

### GET responses are dropping data

`toResource` in `src/lib/repository.js` returns `{ permid: row.permid, ...row.payload }`, which is
the JSONB as stored. Since the payload conversions, fields marked `x-storage` live in columns or
child tables, and only `merge()` puts them back. The API never calls it:

| Field | Stored in | API GET today |
|---|---|---|
| collection `geography.coordinates.latitude/longitude` | `collections.location` (geography) | **missing**. All 275,554 head rows on localhost have `location`; none has coordinates in the JSONB |
| state `quantitative` | `states.quantitative` | **missing** |
| authority `reference` | `authorities.reference_id` | `{ title, permid, href }` from link enrichment; `out` says a permid string |
| collection/schema `references[]` | `reference_id` + `additional_*_refs` | `primaryReference` + `additionalReferences` |

The first two are bugs. The last two are the shape question this document is about.

### Why reads come first

- A PATCH merges the stored row into a full document before validating it: the same `merge()` and
  codec context a read needs. Reads are the foundation for writes.
- It fixes the missing fields with code that already exists and is tested.
- A create body must agree with what GET returns, so the response shape has to be settled before
  writes.
- The transport layer (envelope, pagination, filters, discovery, 405 handling) doesn't depend on
  payload shape. Only `toResource`, the link machinery and parts of `schema-tree.js` change.
- `codecKeyColumns` and the `selection` argument of `loadCodecContext` were built for callers that
  read in batches. An API page is one: one extra `refs` lookup per page, dictionaries loaded once.

Considered and deferred:
- **Serving the variants as JSON Schema.** Easy and visible, but `/api/v1/schemas` is already the
  morphology-schemas resource, so it needs a route name. Until reads follow `out`, it would also
  describe a contract the API doesn't keep.
- **One shared PG config.** Three small, stable copies. Do it when something needs it.
- **Validating writes.** Needs auth, the merged-PATCH policy, and the read shape settled.

---

## 2. Agreed so far

- **The response contract is a JSON Schema a client can rely on.** Whatever design wins, a client
  gets a schema that honestly describes the response, alongside the create and patch contracts.
- **API schemas need not mirror tables.** Including a linked resource's `title` next to its permid
  is fine if the contract documents it.
- **`deriveVariant` and the codecs may change to support this.** New annotations, and a codec
  context that maps a key to an object (`{ permid, title }`) rather than a single value, are both
  acceptable.
- **The storage layer never knows API paths.** `merge()` may know a link's *target resource name*,
  never its URL. `href` is added at the API boundary, as `hydrateLinkHrefs` / `groupBase` do today.
- **Read-only fields sent in a body are rejected**, not stripped. The 400 should name the path
  (for example `/references/0/title`) so a client that sent back a GET response knows what to remove.
- **Ruled out: decorating items inline while `out` stays unchanged.** Adding `title`/`href` inside
  `references[]` items without changing `out` leaves no honest schema: `out` has
  `unevaluatedProperties: false`, so the real response fails it, and `allOf: [out, overlay]` can't
  fix that, because `unevaluatedProperties` inside `out` only sees what `out` evaluates.

---

## 3. The two candidate designs

### A. Links inside the payload, declared in the source

`out` *is* the GET contract. The source declares which fields are links and which fields are
server-supplied:

| Piece | Says | Consumed by |
|---|---|---|
| `readOnly`, allowed at any depth (today root only) | present in responses, never accepted in bodies | `deriveVariant` |
| `x-link: { target, label }` | this value is another resource; embed these fields | codec context (load), `merge()` (fill), API (href) |

```
source:   reference: { ..., "x-link": { target: "references", label: "title" } }

merge():  reference: { referenceID, title }              ← knows the target's name, not URLs
API:      reference: { referenceID, title, href }        ← boundary adds href
out:      title, href: { ..., readOnly: true }           ← href: { type: string, format: uri-reference }
```

- `readOnly` is a standard keyword: OpenAPI tooling and form generators already understand it.
  It is root-only today only because `patch-guard` checks root keys. With nested `readOnly`,
  `in-create` drops those fields and `unevaluatedProperties: false` rejects them; the merged PATCH
  document is checked the same way. `patch-guard` stays a quick root-level check.
- An `x-out` annotation (a response-only field) is needed only for a field that is neither
  read-only nor a link. None is known yet.
- `x-link` makes the source the one place that says what a link shows. Most of `LINK_TARGETS`
  (`src/lib/resource-tables.js`) and the join SQL in `linkProjections` could go.
- The schema embeds conveniences that change without the document changing. An old version in the
  deferred `/versions` history would show the reference's *current* title.

### B. Links in the envelope, outside `data`

`data` is exactly what `merge()` produces, described by `out` unchanged. Conveniences sit beside it:

```
{
  data:  { ..., references: [ { referenceID, order }, … ] },     ← $ref collection.out.json
  meta:  { … },
  links: { self, next, prev,                                      ← navigation, as today
           <related>: { <permid>: { title, href }, … } }          ← new, API-owned schema
}
```

- The contract is composed: envelope + `out` + a small generic links schema (generable from the
  link targets). Fastify response schemas already work this way.
- What a client gets back from GET is exactly what it may send: no read-only fields inside `data`,
  so nothing to strip before a PATCH.
- `out` stays storage-faithful and shared backend-wide; `title` and `href` stay API concerns.
- Clients look up a title by permid in a second place.
- `links` already holds `self`/`next`/`prev` (navigation, keyed by name). Linked resources need
  their own sub-key or top-level member (JSON:API calls it `included`). Its name is open.
- Where the label comes from (`title`, `citation`, `name`) stays API configuration, much as in
  `LINK_TARGETS` today, unless an `x-link`-style annotation is added for it anyway.

### Both designs need

- `merge()` driving reads, with a contract test that checks each GET response against its schema.
- Removed targets hidden by the codec context. Today the link SQL drops soft-removed targets
  (`NOT COALESCE(r.removed, false)`); `loadCodecContext` filters only on `succeeded_by_id IS NULL`.
  Under A it must also skip removed rows. Under B the related block must.
- `taxa` keeps `LINK_TARGETS` for its `authority` and `accepted` links: it has no payload source.
  Giving it an `out`-only source is a possible later step.

---

## 4. Field shapes

In the sources, the collection and schema `references[]` items are already objects
(`{ referenceID, order }`). Under A, `title` and `href` go beside them and the create body is
unchanged. The exceptions are scalar links:

| Field | Source today | Under A |
|---|---|---|
| authority `reference` | permid string (`referencePermid`) | `{ referenceID, title, href }`; create sends `{ referenceID }` |
| person `authorizer` | permid string (`personPermid`) | same rule, once persons have a route |

Under B the scalar fields can stay strings: the title is found in the related block.

Naming: the sources call the link value `referenceID`, while the API's link objects call it
`permid`. The contract should use one. `referenceID` is already in the sources and codecs, and it
says what is being referenced.

---

## 5. JSON Hyper-Schema, for the `href` question

An alternative to the API writing `href` values into responses. It doesn't decide A vs B; it works
with either.

- **What it is:** a companion vocabulary to JSON Schema. Its `links` keyword holds Link
  Description Objects:
  - `rel`: the relation, such as `"author"` or `"collection"`.
  - `href`: an RFC 6570 URI template filled from the instance, e.g. `"references/{referenceID}"`.
  - `templatePointers`: where the template's variables come from in the document.
  - `targetSchema`: the schema of what is found at the link.
  - `submissionSchema`: the schema of what is sent to it, which could be `in-create` or
    `patch-guard`.
- **Version:** the latest is draft 2019-09 (draft-handrews-json-schema-hyperschema-02), the draft
  the payload schemas already use.
- **Why it fits:**
  - The schema says "this value links to `references/{referenceID}`" and the client builds the URL.
    The storage layer never knows a path, and `href` values need not be in the payload at all.
  - It gives a standard place to point from a response schema to its create and patch contracts.
- **Against it:**
  - It stalled: there is no 2020-12 hyper-schema, and work on it hasn't continued. It is stable
    but unmaintained.
  - Tooling is thin. ajv doesn't implement it; `links` would be registered as an annotation-only
    keyword, like the `x-*` annotations. Generic link-following clients are rare, so the frontend
    would expand the templates itself.
  - The name `links` is overloaded: a schema keyword in JSON Hyper-Schema, an operation-based
    feature in OpenAPI 3, and response navigation in our envelope. No technical conflict, but
    confusing in documentation.

---

## 6. Open questions

1. **A or B.** In-payload links declared in the source, or a related block in the envelope.
2. **Under A:** is any `x-out` field needed beyond nested `readOnly` and `x-link`?
3. **Under B:** the name and shape of the related block, and whether it carries anything beyond
   `title` and `href`.
4. **Pilot:** all JSONB resources at once, or one first. Collections shows the most (coordinates and
   references); authorities is the smallest with a shape decision.
5. **`href`:** plain values added by the API (as today), or URL templates à la JSON Hyper-Schema
   (`"href": "references/{permid}"`) so clients build them (§5).
6. **Change layout:** one OpenSpec change (contract design plus reads), or two (annotations first,
   API reads second).

Next step: decide 1, then start the OpenSpec change so the decisions land in its `design.md`.
