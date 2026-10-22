## Context

The three index documents (`/`, `/api`, `/api/v1`) are built by `api/src/plugins/discovery.js`.
Each child path segment is derived from the route table (hidden routes skipped) and written into
`links` beside `self`; `/api/v1` also gets `describedby` and `docs` (`add-openapi-for-reads`, D10).
The published shape is `INDEX_ENVELOPE` in `api/src/plugins/envelope.js`, whose `links` allows any
string-valued key.

So `links` on an index mixes registered link relations with child names, while every other response's
`links` holds only registered relations (`self`, `next`, `prev`). An explore session on 2026-10-21
compared the standard ways to separate them and chose children in `data` plus the RFC 8631
relations (options 3 and 1 of that session).

Today `/api/v1` reads:

```json
"links": {
  "self": "…/api/v1",
  "authorities": "…/api/v1/authorities", "collections": "…", "references": "…",
  "schemas": "…", "taxa": "…",
  "describedby": "…/api/v1/openapi.json",
  "docs": "…/api/v1/docs"
}
```

## Goals / Non-Goals

**Goals:**
- `links` on every response holds only registered link relations.
- An index's children are its content and are read from `data`.
- The shape of a child entry can grow (D10's deferred per-resource detail) without breaking clients.

**Non-Goals:**
- Adding per-resource descriptions or other entry fields now (D10 stays deferred).
- Changing which children are listed, how they are derived, or the hidden-route rule.
- Any change to non-index responses, the envelope, or `meta.type: index`.
- An HTTP `Link` header for the description (rejected in `add-openapi-for-reads`, D10).

## Decisions

### D1. Children move to `data.resources`

On all three indexes, `data.resources` maps each child segment's name to an entry. The node's
existing fields (`name`, `version`, `description`) stay beside it.

*Why:* an index exists to list its children, so they are its content, and `data` is where the
envelope puts content. `links` is how the node relates to other resources. The richer index deferred
in D10 of `add-openapi-for-reads` also belongs in `data`.

*Alternatives (explore session):*
- `links.item` as an array (RFC 6573). Keeps `links` relation-only, but a client must search an array
  for `references`, and per-resource detail would sit inside `links`.
- A JSON Home document (draft-nottingham-json-home). Designed for this, but it leaves our envelope and
  never became an RFC.
- The description in an HTTP `Link` header, with children left in the body's `links`. It does not
  separate the vocabularies in the body, and it hides the description from someone reading the JSON.

### D2. Each entry is an object, `{ href }`

```json
"resources": {
  "references": { "href": "…/api/v1/references" },
  …
}
```

*Why:* a later `description` or `type` beside `href` only adds fields, so a client reading
`resources.taxa.href` keeps working. A plain URL would need a second breaking change to grow. `href`
is also the name every link inside `data` uses (`ReferenceLink`, the containing chain).

*Alternative:* a plain URL per name, one level flatter, rejected for the second breaking change.

### D3. The description's relations are `service-desc` and `service-doc` (RFC 8631)

On `/api/v1`, `links["service-desc"]` is `<base>/api/v1/openapi.json` and `links["service-doc"]` is
`<base>/api/v1/docs`. They replace `describedby` and `docs`.

*Why:* RFC 8631 defines these two relations for exactly this: a machine-readable description of a
service and its human-readable documentation. `docs` is not a registered relation. `describedby`
(registered by POWDER) means "a description of this resource" in general; JSON:API 1.1 uses it for
an API description, but `service-desc` is the specific one.

The two relations stay on `/api/v1` only: the description belongs to a version (D10).

### D4. One shape for all three indexes

`/` lists `resources.api` and `/api` lists `resources.v1`, as `/api/v1` lists its resource groups.
`links` on `/` and `/api` is `{ self }`.

*Why:* one schema and one rule for clients. The higher nodes' children are versions rather than
resources, but `resources` here means "what lies under this path", as discovery derives it.

### D5. The published index schema is closed

`INDEX_ENVELOPE` declares `links` as `self` (required) plus optional `service-desc` and
`service-doc`, with `additionalProperties: false`, and `data.resources` as a required map whose
values are `{ href }`, closed. Today `links` accepts any key; closing it is what makes "relations
only" checkable, and the tests validate every index against it.

### D6. No transition aliases

The old keys are not served alongside the new ones. No client is known to read the index, and
`tidy-response-shape` set the precedent of renaming without an alias before the API has users.

## Risks / Trade-offs

- [A client reads `links.<resource>`, `links.describedby` or `links.docs`] → none is known; check
  the frontend before applying (Open Questions). The proposal marks the change **BREAKING**.
- [`resources` is a slight misnomer on `/` and `/api`, whose children are API levels] → accepted for
  one shape (D4); the spec defines it as the node's children.
- [A key containing a hyphen (`service-desc`) needs bracket access in JavaScript] → the price of the
  registered names; no camelCase alias (D6).

## Open Questions

- Does the frontend read any index document today? If it does, the change breaks it and needs a
  coordinated update.
- `api-discovery`'s Purpose says the indexes' "links enumerate their children". A delta spec cannot
  change a Purpose, so it is reworded by hand when the deltas are synced (a task).
