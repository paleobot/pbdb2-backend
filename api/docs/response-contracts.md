# PBDB2 API — Response Contracts and Shared Payload Code

**Status:** Design A chosen (2026-10-06, §6). It is built for authorities in the OpenSpec change
`authority-reads-from-payload-schemas`; collections, schemas and the rest follow in later changes.
**Audience:** PBDB2 backend contributors
**Subject:** How the API starts using `payloadSchemas/`, and where linked-resource conveniences
(`title`, `href`) belong in a GET response

This picks up the backlog entry "API responses vs. the `out` variants"
(`docs/api-design-backlog.md`). It records one discussion: what was found, what was agreed, and
the two designs still in the running, and why A is favoured (§6).

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

merge():  reference: { permid, title }                   ← knows the target's name, not URLs
API:      reference: { permid, title, href }             ← boundary adds href
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
  data:  { ..., references: [ { permid, order }, … ] },          ← $ref collection.out.json
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
(`{ permid, order }`, after the rename below). Under A, `title` and `href` go beside them and the create body is
unchanged. The exceptions are scalar links:

| Field | Source today | Under A |
|---|---|---|
| authority `reference` | permid string (`referencePermid`) | `{ permid, title, href }`; create sends `{ permid }` |
| person `authorizer` | permid string (`personPermid`) | same rule, once persons have a route |

Under B the scalar fields can stay strings: the title is found in the related block.

Naming (decided 2026-10-06): a link object names the target's id **`permid`**. The sources had
called it `referenceID` (in `references[]` items, since the hand-written `collections.schema.js`),
while the API's link objects and every resource's own id use `permid`. The inconsistency would
only spread, and `permid` is the target's own field name, so stub rule 1 below needs no exception.
The rename is cheap: `references[]` is stored in columns and join tables, so no jsonb at rest
holds `referenceID` (0 collections, 0 schemas on localhost), and only `payloadSchemas/` (sources,
`referenceList`, tests) and the `payload-schema-variants` spec use the name. The field name says
nothing about what is referenced; the enclosing field (`reference`, `references`) does.

### Keeping a later include additive

A general include parameter (Classic's `show`, JSON:API's `include`) is deferred
(`docs/api-design-backlog.md`, "Including related resources"). Under A, including a linked
resource means filling in the stub that is already there:

```
stub today:          { permid, title, href }
with an include:     { permid, title, href, authors, publicationYear, doi, … }
```

Two rules on stubs keep that change additive, so clients that ignore includes are unaffected:

1. **A stub's fields use the target's own names and meanings.** The labels already do:
   `reference.title`, `authority.citation`, and the id is the target's `permid`. Included fields
   keep their names too.
2. **Stub fields are always present but optional; included fields are optional `readOnly` fields
   on top.** `title` cannot be required: 541 migrated references have none. One schema then
   describes the response with or without an include. `deriveVariant` could later generate the
   included fields from `x-link.target` and the target's `out`.

Reverse relations (a collection's specimens) have no field in the payload, so these rules don't
reach them; see the backlog entry.

---

## 5. JSON Hyper-Schema, for the `href` question

An alternative to the API writing `href` values into responses. It doesn't decide A vs B; it works
with either.

- **What it is:** a companion vocabulary to JSON Schema. Its `links` keyword holds Link
  Description Objects:
  - `rel`: the relation, such as `"author"` or `"collection"`.
  - `href`: an RFC 6570 URI template filled from the instance, e.g. `"references/{permid}"`.
  - `templatePointers`: where the template's variables come from in the document.
  - `targetSchema`: the schema of what is found at the link.
  - `submissionSchema`: the schema of what is sent to it, which could be `in-create` or
    `patch-guard`.
- **Version:** the latest is draft 2019-09 (draft-handrews-json-schema-hyperschema-02), the draft
  the payload schemas already use.
- **Why it fits:**
  - The schema says "this value links to `references/{permid}`" and the client builds the URL.
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

## 6. Which design helps clients display data

Discoverability through the API is a goal: responses carry links, not bare permids. Both designs
do that. They differ in where a client finds the link, and that decides how much display code a
client writes.

Today's API already embeds links inline: authority `reference` comes back as
`{ title, permid, href }`. A gives that shape a schema; B changes what clients see now.

### By client

| Client | A (inline) | B (envelope) |
|---|---|---|
| Person reading JSON in a browser | follows `href` where the value is | finds the permid, then looks for it in another member |
| Web app, detail view | `<a href={c.reference.href}>{c.reference.title}</a>` | looks up `links.<related>.references[c.reference]` for every link, and must know which fields are links |
| Web app, tables (AG Grid, TanStack Table, DataTables) | a column accessor `"reference.title"` works | each link column needs a custom cell renderer |
| R / pandas (`jsonlite::fromJSON(..., flatten = TRUE)`, `json_normalize`) | `reference.title` becomes a column | a manual merge per link |
| Generic tools (form generators, OpenAPI) | nested `readOnly` is standard | a custom vocabulary |
| Editing UI (GET → PATCH) | must drop `readOnly` fields before sending | sends `data` back as-is |

- Under A the shape of a value says it is a link: an object with `href`. A generic renderer can
  turn any such object into a link without knowing field names.
- Scripted clients matter. Classic PBDB's users are largely R and Python scientists, and Classic
  gives them inline `show=ref` fields and CSV for that reason.
- B saves repeating a reference's title across a page of rows. At our page sizes that saving is
  negligible.
- JSON:API is B-like (`relationships` linkage plus `included`). In practice clients use a library
  (ember-data, Jsona, devour) to rebuild the inline graph. That fits large partial object graphs
  and normalized caches. We embed a label and a link.

### What B still has, and what answers it under A

- **GET body equals PATCH body.** Under A, the read-only fields are marked in the schema, so a small
  generic `stripReadOnly(schema, doc)` can drop them, and could be published for clients. The 400
  that names the path (§2) covers clients that don't. Form libraries (RJSF, JSON Forms) already
  honour `readOnly`. An edit UI needs the new target's title anyway, and its picker supplies it.
- **Lighter server code.** True of B as built today. A moves the cost into `x-link` and nested
  `readOnly`, but most of `LINK_TARGETS` and the `linkProjections` join SQL can go, so the total
  does not grow much.
- **Old versions show current titles.** Correct for a display label: a link label names the
  target as it is now. `readOnly` and the contract say `title` is not part of the record.

### A fallback, if embedding titles proves costly

`href` and `title` are different kinds of value:

```
href   = f(permid)          no lookup, never stale
title  = lookup(target)     cross-table join, changes independently
```

Inline `href` (or a Hyper-Schema template, §5) with titles in a side block is possible. It brings
B's lookup back for the field display code uses most, so use it only if a codec context that maps
a key to `{ permid, title }` turns out to be hard.

### Conclusion

A serves every reading client: browser, web-app tables, R and pandas, generic tools. B serves the
one client that writes, and writers already need a schema-aware client and authentication; the
schema tells them exactly what to strip. Optimise for readers: **leaning A.**

Still worth checking: whether the PBDB2 web app plans a normalized cache (TanStack Query, RTK
Query). That would weaken the case for A slightly, not reverse it.

---

## 7. Open questions

Settled 2026-10-06, in `authority-reads-from-payload-schemas` (design.md has the reasoning):

1. **A or B:** A.
2. **`x-out`:** not needed. Nested `readOnly` and `x-link` cover every response-only field found so
   far.
3. **Under B:** no longer applies.
4. **Pilot:** authorities first.
5. **`href`:** plain root-relative paths added by the API, as before. Full URLs are deferred
   (`docs/api-design-backlog.md`, "Full URLs in links"), and so are Hyper-Schema templates.
6. **Change layout:** one change for the annotations and the reads. The `referenceID` → `permid`
   rename went first, as its own change.

Still open: how collections and schemas treat a removed reference in `references[]` under
`merge()`, and how the write path rejects a PATCH that touches a nested read-only field such as
`reference.title`. The merged-document check can't catch one, because read-only fields are
removed before it runs.
