## Why

Every link the API emits is a root-relative path (`/api/v1/references/{permid}`). A relative link
only works while the response is still attached to the request it answered: a saved response, one
pasted into an issue, a record cached by a script, or a link followed by a naive client loses its
host. Full URLs make every link followable as is, clickable in browser JSON viewers, and able to
point at another host later. Nobody outside the team consumes the API yet, so the response shape
can change now without breaking anyone; later it would be a breaking change for real clients.

The backlog entry "Full URLs in links" (`docs/api-design-backlog.md`) recorded the approach on
2026-10-06: a configured public base URL, applied API-wide in one change so no response mixes paths
and URLs.

## What Changes

- **BREAKING (response shape):** every URL in a response becomes absolute, formed as the configured
  public base URL followed by the path the API emits today:
  - each hydrated `href` (payload-source links, descriptor links, the taxa `containingTaxa` chain);
  - the envelope's `links.self`, on single, list and index responses;
  - the pagination links `links.next` / `links.prev`;
  - the discovery documents' child links at `/`, `/api` and `/api/v1`.
- New `PUBLIC_BASE_URL` setting in the root `.env`, defaulting to `http://localhost:<PORT>` for
  local development. `src/server.js` refuses to start outside development when it is unset.
  `build()` takes it as an option, with a fixed default, so tests do not depend on the environment.
- The base is never derived from the request's `Host` or `X-Forwarded-*` headers.
- Paths themselves do not change: routing, the `/api/v1` prefix, permids and query strings are as
  before.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `api-foundation`: adds the public base URL setting and the requirement that every link in a
  response is an absolute URL built from it.
- `api-discovery`: discovery documents' `self` and child links become absolute URLs.
- `reference-enrichment`: the requirements and scenarios that state an `href` as the literal path
  `/api/v1/references/{permid}` now state it as the public base URL followed by that path.

`list-pagination` and `taxa-reads` describe their links only as "a URL" or "`href`", which the new
`api-foundation` requirement governs; their requirements do not change.

## Impact

- **Code (`api/`):** `src/config.js` (new setting), `src/app.js` (`build()` option and a decorator
  carrying the base), `src/server.js` (startup check), `src/plugins/envelope.js` (`links.self`),
  `src/lib/cursor.js` (`pageLinks`), `src/lib/link-hydration.js` (every `href`),
  `src/plugins/discovery.js`, and the call sites in `src/lib/crud-routes.js` and the `schemas` and
  `taxa` route groups.
- **Tests:** about 75 link assertions across nine unit and integration test files change from paths
  to URLs.
- **Configuration:** root `.env.example` gains `PUBLIC_BASE_URL`.
- **Docs:** `api/CLAUDE.md`, `api/docs/response-contracts.md` (§7 item 5 says `href` stays a path),
  `api/docs/api-response-envelope-comparison.md` examples, and the backlog entry, which this change
  closes.
- **Data integrity:** none. Links are generated per response and never stored; no table, payload or
  migration changes.
- **Clients:** none outside the team yet. A client that joined `href` onto its own base would now
  produce a doubled URL, which is the breaking case if one exists.
