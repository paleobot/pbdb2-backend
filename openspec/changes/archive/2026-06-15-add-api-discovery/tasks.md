## 1. Discovery plugin

- [x] 1.1 Create `src/plugins/discovery.js` (fastify-plugin wrapped) with an `onRoute` hook that records each registered route path into an inventory
- [x] 1.2 In an `onReady` hook, build the link maps for `/`, `/api`, and `/api/v1` by taking the distinct next path-segment of every route beneath each base path (dedupe, ignore `:param` segments)
- [x] 1.3 Register GET handlers for `/`, `/api`, and `/api/v1` that serve the precomputed documents via the `{ data, meta, links }` envelope with `meta.type` of `index` and a `self` link

## 2. Envelope integration

- [x] 2.1 Produce index documents through the existing envelope helper (or a thin index-specific helper) so the response shape matches the rest of the API
- [x] 2.2 Confirm the discovery plugin loads before routes so its `onRoute` hook captures all resource routes

## 3. Tests

- [x] 3.1 Add a test asserting `/`, `/api`, and `/api/v1` return 200 with the `{ data, meta, links }` envelope and `meta.type` of `index`
- [x] 3.2 Add a test asserting `/api/v1` links include all five resource groups and `self`, and that `/` links to `/api`
- [x] 3.3 Add a test asserting a resource with both collection and `/:permid` routes appears exactly once in `/api/v1` discovery
- [x] 3.4 Add a test asserting an unknown path (e.g. a misspelled resource) still returns the structured 404

- [x] 3.5 Enable `ignoreTrailingSlash` (via `routerOptions`) in the app factory and add a test asserting base paths tolerate a trailing slash

## 4. Verification

- [x] 4.1 Run `npm test` and confirm all tests pass
- [x] 4.2 Run `npm start` and manually confirm `/`, `/api`, and `/api/v1` return discovery documents with derived links
