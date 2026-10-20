## Context

The API emits URLs in four places, all root-relative today:

| Where | Built by | Today |
|---|---|---|
| `links.self` (single, list, index) | `src/plugins/envelope.js`, from `request.url` | `/api/v1/collections?limit=2` |
| `links.next` / `links.prev` | `pageLinks()` in `src/lib/cursor.js`, which parses `request.url` against a throwaway origin and keeps only path + query | `/api/v1/collections?limit=2&cursor=…` |
| hydrated `href` | `src/lib/link-hydration.js`: `groupBase(prefix, group)` + `addHref()`, called from `crud-routes.js`, `routes/api/v1/schemas`, `routes/api/v1/taxa` | `/api/v1/references/{permid}` |
| discovery child links | `src/plugins/discovery.js`, built once at `onReady` | `/api/v1/references` |

The persistence layer already emits no URLs (`reference-enrichment`): every URL is made at the route
or envelope boundary, so the change stays inside those four places and their call sites.

Nothing deploys the API yet. `src/server.js` loads the root `.env` and already refuses to start
without the `PG_*` variables. Unit tests call `build()` directly with no `.env` loaded; the
integration harness loads the root `.env`.

## Goals / Non-Goals

**Goals:**
- Every URL in a response body is absolute and starts with one configured base.
- The base is set in one place and cannot be influenced by the request.
- Tests stay deterministic whatever the developer's `.env` holds.

**Non-Goals:**
- Changing any path, the `/api/v1` prefix, permids or query strings.
- URI templates or JSON Hyper-Schema (still deferred in the backlog).
- URLs inside error messages (the 404 body's `Route GET /x not found`): those are diagnostics, not
  links.
- `Location` headers: no route sets one yet. The write path will, and should use the same base.

## Decisions

### D1. A configured base, never derived from the request

`PUBLIC_BASE_URL` in the root `.env`. Deriving the base from `Host` / `X-Forwarded-Proto` /
`X-Forwarded-Host` was the alternative. It needs `trustProxy` set exactly right for each deployment.
It copies client-controlled headers into response bodies, which is a host-header injection and
cache-poisoning risk. It also gives one resource different bodies depending on which hostname
reached it. A configured base is one line of configuration per environment and has none of those
problems.

### D2. Validated and normalized once, at `build()`

The base SHALL parse as an absolute `http:` or `https:` URL with no query, fragment or credentials.
A trailing `/` is removed. A path is allowed (`https://example.org/pbdb2`) for a proxy that mounts
the API under a prefix and strips it before forwarding. An invalid value throws from `build()`, so a
misconfigured server fails at startup, not on the first request.

Because the base has no trailing slash and every path the API emits starts with `/`, an absolute URL
is plain concatenation, `base + path`. No URL resolution is involved, which would drop the base's
path for a root-relative reference.

### D3. One decorator, string concatenation at each site

`build()` decorates the root instance with `publicBaseUrl` (the normalized string). Each of the four
sites prefixes the path it already builds:
- envelope: `this.server.publicBaseUrl + this.request.url`, for `self` on all three decorators;
- `pageLinks(url, page, cursor, base)`: keeps its parse-and-set-cursor logic and returns
  `base + pathname + search`;
- link hydration: `hydrateLinkHrefs`, `hydrateSourceLinks` and `hydrateChainHrefs` take the base as
  a final argument and `addHref` writes `base + groupPath + '/' + permid`. `groupBase()` keeps
  returning a path, because `path.posix.join` would mangle `https://` and the version-relative
  derivation is a path operation;
- discovery: link maps are still built once at `onReady`, prefixed with the base.

A `fastify.publicUrl(path)` helper decorator was the alternative. It would save little, since
concatenation is the whole operation, and the hydration module would still need the base passed in
to stay free of Fastify. A response-wide `onSend` rewrite of every `href` and `links.*` field was
rejected: it walks every body, and it must guess which strings are links.

### D4. Defaults: development convenience, production guard, test determinism

- `loadConfig()` returns `publicBaseUrl: env.PUBLIC_BASE_URL ?? \`http://localhost:${port}\``.
- `src/server.js` passes it to `build()`, and exits with a message naming `PUBLIC_BASE_URL` when it
  is unset and `NODE_ENV` is not `development`, as it does for `PG_*`. A server in another
  environment would otherwise send `localhost` links to real clients.
- `build()` defaults the option to the exported constant `DEFAULT_PUBLIC_BASE_URL`
  (`http://localhost:3000`), **not** to `loadConfig()`. Tests then do not change with a developer's
  shell or `.env`, and they assert against the constant rather than repeating the literal.

The alternative, `build()` reading the environment itself, would let a `PUBLIC_BASE_URL` in `.env`
(which the integration harness loads) break every link assertion.

### D5. `self` is the request as received

`links.self` stays `request.url`, path plus query exactly as sent, with the base in front. It is not
re-serialized into a canonical URL (sorted or normalized parameters). That would be a separate
change to what `self` means.

### D6. Test approach

- Existing assertions change from `'/api/v1/…'` to `` `${DEFAULT_PUBLIC_BASE_URL}/api/v1/…` ``.
- One new test file builds the app with a distinct base that has a path
  (`https://pbdb2.example.org/base`) and checks that each kind of link starts with it: `self` on a
  single, list and index response, `next`/`prev`, a source `href`, a descriptor `href`, a
  `containingTaxa` `href`, and discovery child links.
- Config tests cover the trailing-slash normalization and the rejected forms: relative, non-http,
  query, fragment, credentials.

## Risks / Trade-offs

- [A deployment sets the wrong base, so every link points at the wrong host] → The production guard
  catches it only when the value is missing. `server.js` logs the base at startup so a wrong value is
  visible. Add the variable to the deployment checklist when one exists.
- [One server is reached through several hostnames (public domain, internal load balancer)] → Links
  always name the configured public one. That is intended: links are for clients, and internal
  callers can follow them or ignore them.
- [The proxy does not strip a path prefix in the base] → Routes would not match either, so it shows
  up at once as 404s rather than as wrong links.
- [A client already joins `href` onto its own base and now gets a doubled URL] → No external clients
  exist. This is why the change happens now.
- [About 75 test assertions change] → Mechanical. The shared constant keeps them short and makes a
  later base change a one-line edit.
- [Responses are a little larger] → About 22 bytes per link with the default base, and gzip removes
  most of it.

## Migration Plan

There is no deployed API, so there is nothing to roll out. Add `PUBLIC_BASE_URL` to the root
`.env.example`. Rollback is a revert: no data or schema is involved.

## Open Questions

None blocking. The production value of `PUBLIC_BASE_URL` (for example `https://api.pbdb2.org`)
depends on a hosting decision that hasn't been made; the code does not care.
