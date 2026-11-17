## Why

`/api/v1/docs` shows `@fastify/swagger-ui`'s defaults: the Fastify logo in the top bar, Fastify
favicons, and the tab title "Swagger UI". Stakeholders look at this page, and it reads as a framework
demo rather than PBDB's API. PBDB2 has no visual identity of its own yet, so this change borrows the
Classic data service's (`https://paleobiodb.org/data1.2/`) as a stopgap. Use of the branding is
approved (explore session, 2026-10-22).

## What Changes

- The docs page's top bar uses Classic's teal (`#00A0A0`, the `.banner` colour in data1.2's
  `dsdoc.css`) and shows Classic's white PBDB emblem (`/data1.2/images/logo_white.png`) in place of
  the Fastify logo. The bar stays teal in Swagger UI's dark mode, and its explore bar (URL input and
  green Explore button) is hidden: it serves no purpose on a single-description page and clashes
  with the teal.
- The page's favicon is Classic's (`https://paleobiodb.org/favicon.ico`) in place of Fastify's.
- The tab title is the version node's name (`PBDB2 API`) in place of "Swagger UI".
- The two image files are committed to the repo, with their source recorded. Nothing is fetched from
  paleobiodb.org at runtime.
- The backlog entry "Docs page branding" stays open, reworded: the page now carries Classic's
  branding as a placeholder until PBDB2 has its own.
- Unchanged: the document, its routes, what the viewer renders, and discovery's `service-doc` link.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `api-description`: "The API serves an OpenAPI 3.1 description of its reads" gains a scenario: the
  viewer carries PBDB branding (title, favicon, logo), not the framework's.

## Impact

- `api/src/plugins/openapi.js`: `logo` and `theme` options on the `@fastify/swagger-ui`
  registration.
- New: `api/assets/pbdb-logo-white.png`, `api/assets/pbdb-favicon.ico`.
- `api/test/openapi.test.js`: the viewer test checks the branding.
- `docs/api-design-backlog.md`: "Docs page branding" reworded.
- No dependency, schema, or database change.
