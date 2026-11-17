import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Fastify from 'fastify';
import autoload from '@fastify/autoload';

import { normalizePublicBaseUrl } from './config.js';
import { createAjv } from '../../payloadSchemas/lib/ajv.js';
import { normalizeQuery, formatQueryErrors } from './lib/query-schemas.js';
import { publishedComponents } from './lib/published-schemas.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * The public base URL `build()` uses when none is passed. Fixed rather than read
 * from the environment, so tests see the same links whatever `.env` holds;
 * `server.js` passes the configured one.
 */
export const DEFAULT_PUBLIC_BASE_URL = 'http://localhost:3000';

/**
 * Build a fully configured Fastify instance WITHOUT listening.
 *
 * Keeping construction (`build`) separate from listening (`server.js`) is what
 * lets tests drive the app in-process via `app.inject()` — no socket, fast and
 * parallel-safe.
 *
 * Load order matters: cross-cutting plugins in `plugins/` (envelope, auth,
 * sensible) are registered before `routes/`, so the decorators they add
 * (`reply.sendData`, `fastify.authenticate`, …) exist by the time routes load.
 */
export function build(opts = {}) {
  // `pg` is a test seam, not a Fastify option: `build({ pg })` injects a fake
  // postgres client so route logic can be driven with no database. The postgres
  // plugin sees the decorator already exists and skips connecting.
  //
  // `publicBaseUrl` is the base every link in a response starts with
  // (`links.self`, `next`/`prev`, `href`, discovery). It is validated here, so a
  // bad value throws before the app exists.
  const { pg, publicBaseUrl = DEFAULT_PUBLIC_BASE_URL, ...fastifyOpts } = opts;
  const base = normalizePublicBaseUrl(publicBaseUrl);

  const app = Fastify({
    logger: false,
    // Treat `/api/v1` and `/api/v1/` as the same route (applies to all routes).
    routerOptions: { ignoreTrailingSlash: true },
    ...fastifyOpts,
  });

  app.decorate('publicBaseUrl', base);
  if (pg) app.decorate('pg', pg);

  // Route schemas compile with the backend's own Ajv (draft 2020-12, the
  // annotation keywords registered), not Fastify's draft-07 default. Every
  // query value arrives as a string, so querystrings and params coerce; nothing
  // is stripped (an unknown parameter is a 400, not ignored), every error is
  // reported, and no default is applied before the `ids` rule reads `limit`.
  // `verbose` gives the error formatter each error's schema. Any other part (a
  // request body, once writes are real) gets no coercion: a body's "12" is a
  // client bug, not 12.
  const queryAjv = createAjv({ coerceTypes: true, removeAdditional: false, useDefaults: false, verbose: true });
  const bodyAjv = createAjv();
  app.setValidatorCompiler(({ schema, httpPart }) =>
    (httpPart === 'querystring' || httpPart === 'params' ? queryAjv : bodyAjv).compile(schema),
  );
  app.addHook('preValidation', normalizeQuery);
  app.setSchemaErrorFormatter((errors, dataVar) => formatQueryErrors(app.httpErrors, errors, dataVar));

  // Response schemas document the contract; they do not reshape it. A response
  // is serialized as the handler built it, so a field a schema does not declare
  // is never dropped, coerced or blanked (fast-json-stringify would). Tests
  // validate real responses against the published schemas instead.
  app.setSerializerCompiler(() => JSON.stringify);

  // The published components (`Collection`, `ReferenceLink`, …) that route
  // response schemas reference as `'<Name>#'`, and the description lists under
  // `components.schemas`. Shared schemas must exist before routes load.
  for (const schema of publishedComponents()) app.addSchema(schema);

  // Cross-cutting plugins first (each is fastify-plugin wrapped, so its
  // decorators apply to this root instance rather than being encapsulated).
  app.register(autoload, {
    dir: join(__dirname, 'plugins'),
  });

  // Resource routes. The URL prefix is derived from the directory layout:
  // routes/api/v1/<resource>/index.js -> /api/v1/<resource>.
  app.register(autoload, {
    dir: join(__dirname, 'routes'),
  });

  // Structured 404 for unmatched routes.
  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({
      error: {
        statusCode: 404,
        error: 'Not Found',
        message: `Route ${request.method} ${request.url} not found`,
      },
    });
  });

  // Structured error body for everything else, preserving HTTP status codes.
  app.setErrorHandler((err, request, reply) => {
    const statusCode = err.statusCode ?? 500;
    if (statusCode >= 500) request.log.error(err);
    reply.code(statusCode).send({
      error: {
        statusCode,
        error: err.name || 'Error',
        message: err.message,
      },
    });
  });

  return app;
}
