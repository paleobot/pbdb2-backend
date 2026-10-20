## 1. Configuration

- [x] 1.1 `src/config.js`: `loadConfig()` returns `publicBaseUrl` (`PUBLIC_BASE_URL`, default `http://localhost:<port>`)
- [x] 1.2 Add a validate-and-normalize function for the base (absolute `http:`/`https:`, no query, fragment or credentials, path allowed, trailing `/` removed; throws otherwise), with unit tests for each accepted and rejected form
- [x] 1.3 `src/app.js`: `build({ publicBaseUrl })`, defaulting to an exported `DEFAULT_PUBLIC_BASE_URL` (`http://localhost:3000`), not the environment; validate it and decorate the root instance with `publicBaseUrl`
- [x] 1.4 `src/server.js`: pass `config.publicBaseUrl` to `build()`; exit with a message naming `PUBLIC_BASE_URL` when it is unset and `NODE_ENV` is not `development`; log the base at startup
- [x] 1.5 Root `.env.example`: add `PUBLIC_BASE_URL` to the API server section, with the default and the production rule

## 2. Link sites

- [x] 2.1 `src/plugins/envelope.js`: `links.self` is `publicBaseUrl + request.url` in `sendData`, `sendList` and `sendIndex`
- [x] 2.2 `src/lib/cursor.js`: `pageLinks()` takes the base and returns `base + pathname + search`; update its call in `src/lib/crud-routes.js`
- [x] 2.3 `src/lib/link-hydration.js`: `hydrateLinkHrefs`, `hydrateSourceLinks` and `hydrateChainHrefs` take the base as a final argument and `addHref` prefixes it; `groupBase()` still returns a path. Update the doc comments
- [x] 2.4 Pass `fastify.publicBaseUrl` at every hydration call site: `src/lib/crud-routes.js`, `src/routes/api/v1/schemas/index.js` (including the characters tree), `src/routes/api/v1/taxa/index.js`
- [x] 2.5 `src/plugins/discovery.js`: prefix `self` and child links with the base when the link maps are built at `onReady`
- [x] 2.6 Search `src/` for any other place a path reaches a response body (`request.url`, `prefix`, `/api/v1`) and confirm each is either converted or a diagnostic (error messages stay as they are)

## 3. Tests

- [x] 3.1 Update unit-test link assertions (`pagination`, `envelope`, `repository`, `link-enrichment`, `discovery`, `taxa`, `source-reads`) to expect `` `${DEFAULT_PUBLIC_BASE_URL}/…` ``
- [x] 3.2 Update integration-test link assertions (`test/integration/reads.test.js`, `test/integration/taxa.test.js`); following a `links.next` with `app.inject` must still work (inject takes the path, or a full URL)
- [x] 3.3 New test file: build with `https://pbdb2.example.org/base` and assert every link kind starts with it (`self` on single, list and index; `next`/`prev`; a source `href`; a descriptor `href`; a `containingTaxa` `href`; discovery child links), and that `Host` / `X-Forwarded-Host` headers do not change any of them (done in `test/public-base-url.test.js`, plus one test each in `pagination` and `taxa`, which already hold the fakes those links need)
- [x] 3.4 Test that `build()` ignores `PUBLIC_BASE_URL` in the environment when no option is passed
- [x] 3.5 Test the `server.js` production guard, or document why it is checked by hand if it can't be unit-tested without a socket
- [x] 3.6 `npm test` (root) and `npm run test:integration` pass

## 4. Documentation

- [x] 4.1 `api/CLAUDE.md`: note absolute links and `PUBLIC_BASE_URL` (key patterns, commands/env), and fix the stale "does not yet talk to that database" line while there
- [x] 4.2 `api/docs/response-contracts.md` §7 item 5 and `api/docs/api-response-envelope-comparison.md` examples: hrefs and `links` are absolute URLs
- [x] 4.3 `docs/api-design-backlog.md`: mark "Full URLs in links" as done by this change, or remove it
- [x] 4.4 `openspec validate absolute-link-urls --strict` passes
