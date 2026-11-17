import { readFileSync } from 'node:fs';

import fp from 'fastify-plugin';
import fastifyPostgres from '@fastify/postgres';

import { loadPgConfig } from '../config.js';

/**
 * PostgreSQL connection seam.
 *
 * Registers @fastify/postgres from the `PG_*` environment (see loadPgConfig),
 * exposing `fastify.pg` (with `query`/`transact` helpers) and a pool capped at
 * 5 connections. The plugin owns shutdown via @fastify/postgres's own `onClose`
 * hook, which drains the pool.
 *
 * Two deliberate escape hatches keep this usable everywhere:
 *  - If `fastify.pg` is ALREADY decorated (a test injected a fake via
 *    `build({ pg })`), we skip — the fake stands in for a real connection so
 *    route logic can be exercised with no database.
 *  - If the `PG_*` vars are not configured, we skip with a clear warning rather
 *    than crashing. The API is reads-only and falls back to stub data, and the
 *    in-process test suite must run without a database. Routes detect the
 *    absence of `fastify.pg` and serve stubs.
 */
export default fp(async (fastify) => {
  if (fastify.hasDecorator('pg')) {
    fastify.log?.info?.('postgres: fastify.pg already present (injected) — skipping real connection');
    return;
  }

  const pg = loadPgConfig();

  if (!pg.configured) {
    // Silent under logger:false (the in-process test suite); the real server
    // runs with logging on, where this surfaces. Reads-only → stub fallback.
    fastify.log?.warn?.(
      `postgres: missing ${pg.missing.join(', ')} — DB-backed reads disabled, serving stub data`,
    );
    return;
  }

  const ssl = pg.caCertPath ? { ca: readFileSync(pg.caCertPath) } : false;

  await fastify.register(fastifyPostgres, {
    host: pg.host,
    port: pg.port,
    user: pg.user,
    password: pg.password,
    database: pg.database,
    ssl,
    max: 5,
  });
});
