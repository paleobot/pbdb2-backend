## 1. Project setup

- [x] 1.1 Confirm `package.json` is configured for ES modules and add `fastify`, `@fastify/autoload`, and `@fastify/sensible` as dependencies
- [x] 1.2 Replace placeholder `scripts` with real `start` (run `src/server.js`) and `test` (`node --test`) scripts
- [x] 1.3 Create the `src/` and `test/` directory structure (`src/routes/api/v1/`, `src/plugins/`)

## 2. Application foundation

- [x] 2.1 Implement `src/config.js` to read host/port and environment from `process.env` with sensible defaults
- [x] 2.2 Implement `src/app.js` exporting a `build()` factory that registers plugins and routes and returns the instance without listening
- [x] 2.3 Implement `src/server.js` that imports `build()`, reads config, and starts listening
- [x] 2.4 Register `@fastify/autoload` for `src/plugins/` and for `src/routes/api/v1/` so the `/api/v1` prefix is derived from the directory layout
- [x] 2.5 Add a 404 / error handler producing a structured error body with correct HTTP status codes

## 3. Response envelope

- [x] 3.1 Implement an envelope helper (e.g. reply decorators `sendData` and `sendList`) that produces `{ data, meta, links }` with `permid` identity, single-object vs array `data`, reserved `meta.version`, and reserved `links.next`/`links.prev` slots
- [x] 3.2 Ensure internal serial identifiers are never included in `data`

## 4. Auth seam

- [x] 4.1 Implement `src/plugins/auth.js` decorating the instance with a no-op `fastify.authenticate` preHandler, documented in-code as a stub
- [x] 4.2 Provide a way for routes to attach `authenticate` as a `preHandler` to write verbs only

## 5. Resource routes (stubbed)

- [x] 5.1 Implement the `references` route group with GET (list + single), POST, PUT/PATCH, DELETE returning stubbed envelope responses, write verbs guarded by `authenticate`
- [x] 5.2 Implement the `authorities` route group following the same uniform CRUD pattern
- [x] 5.3 Implement the `collections` route group following the same uniform CRUD pattern
- [x] 5.4 Implement the `specimens` route group following the same uniform CRUD pattern
- [x] 5.5 Implement the `schemas` route group: CRUD verbs plus a single-read handler returning the aggregate `schema → characters → states` tree shape (stubbed)

## 6. Tests

- [x] 6.1 Add a smoke test that builds the app via `build()` and asserts it is ready without binding a port
- [x] 6.2 Add tests using `app.inject()` asserting the `{ data, meta, links }` envelope shape for a single read and a list read
- [x] 6.3 Add a test asserting GET requests do not require auth and a test asserting the `authenticate` seam is invoked on a write verb
- [x] 6.4 Add a test asserting a path without the `/api/v1` prefix returns 404 with a structured error body

## 7. Verification

- [x] 7.1 Run `npm test` and confirm all tests pass
- [x] 7.2 Run `npm start` and manually confirm a GET and a write request against one resource return the expected envelope
