## 0. Before applying

- [x] 0.1 Check whether the frontend reads any index document (`/`, `/api`, `/api/v1`) today; if it
      does, stop and plan the coordinated update before changing the shape (design.md, Open Questions)
      *(2026-10-21: no client on this machine reads one: `pbdb2-dev`, `pbdb2-api` and `classic` have
      no calls to `/api/v1`. A frontend not on this machine was not checked.)*

## 1. Index documents (`api/`)

- [x] 1.1 `src/plugins/discovery.js`: build each index's `data.resources` from the derived child
      segments as `{ <segment>: { href: <absolute URL> } }` (D1, D2), and its `links` as `{ self }`
      plus, on `/api/v1` only, `service-desc` → `/api/v1/openapi.json` and `service-doc` →
      `/api/v1/docs` (D3); no child name in `links`, no alias for the old keys (D6); update the
      module comment
- [x] 1.2 `src/plugins/envelope.js`: close `INDEX_ENVELOPE` (D5): `links` has `self` (required) and
      optional `service-desc` / `service-doc`, `additionalProperties: false`; `data.resources` is
      required, a map of closed `{ href }` objects; update its description
- [x] 1.3 `src/plugins/openapi.js`: the comment names the index's `service-desc`, not `describedby`

## 2. Tests (`api/`)

- [x] 2.1 `test/discovery.test.js`: read children from `data.resources.<name>.href` (root lists `api`,
      `/api` lists `v1`, `/api/v1` lists the five resource groups and not `specimens`); `/api/v1`
      `links` is exactly `self`, `service-desc`, `service-doc`; `/` and `/api` `links` is exactly
      `{ self }`; the hidden-route and mixed-route cases assert on `data.resources`
      *(also `test/public-base-url.test.js`, which read `links.api` on the root index)*
- [x] 2.2 Every index validates against the published `INDEX_ENVELOPE` (`assertEnvelope('index', …)`
      in `test/published.js`), and a body with a child name in `links` does not
- [x] 2.3 `test/openapi.test.js`: the coverage walk follows `data.resources` instead of `links`; the
      viewer test reads `links["service-desc"]`

## 3. Docs

- [x] 3.1 `api/CLAUDE.md`: the description is linked from `/api/v1` as `service-desc` and
      `service-doc`; an index lists its children in `data.resources`
- [x] 3.2 At sync, reword `api-discovery`'s Purpose by hand: the index documents list their children
      in `data.resources`, and `links` holds relations (a delta cannot change a Purpose)

## 4. Verify

- [x] 4.1 `npm test` and `npm run test:integration` pass
- [x] 4.2 Against localhost: `/`, `/api` and `/api/v1` have the new shape, and `/api/v1`'s
      `service-desc` and `service-doc` resolve (200, JSON and HTML)
- [x] 4.3 `openspec validate separate-index-links` passes
