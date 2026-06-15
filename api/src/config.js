/**
 * Configuration for the PBDB2 API.
 *
 * Reads from the environment with sensible defaults so the scaffold runs with
 * zero setup. Kept as a plain function (no @fastify/env yet) — a future change
 * can swap in schema-validated config if the surface grows.
 */
export function loadConfig(env = process.env) {
  return {
    host: env.HOST ?? '0.0.0.0',
    port: Number(env.PORT ?? 3000),
    nodeEnv: env.NODE_ENV ?? 'development',
    pg: loadPgConfig(env),
  };
}

/**
 * PostgreSQL connection config, mirroring pbdb2-migrations/pg-pool.js:
 * PG_HOST / PG_PORT / PG_USER / PG_PASSWORD / PG_DATABASE, with PG_CA_CERT
 * presence enabling SSL.
 *
 * Unlike the migrations script (which `process.exit(1)`s on missing vars), this
 * returns `{ configured: false }` when the required vars are absent rather than
 * crashing. The app is reads-only and falls back to stub data, and — crucially
 * — `build()` is used in-process by tests that must run with NO database. The
 * postgres plugin surfaces a clear warning when `configured` is false.
 */
export function loadPgConfig(env = process.env) {
  const required = ['PG_HOST', 'PG_USER', 'PG_PASSWORD', 'PG_DATABASE'];
  const missing = required.filter((key) => !env[key]);

  if (missing.length > 0) {
    return { configured: false, missing };
  }

  return {
    configured: true,
    missing: [],
    host: env.PG_HOST,
    port: Number(env.PG_PORT ?? 5432),
    user: env.PG_USER,
    password: env.PG_PASSWORD,
    database: env.PG_DATABASE,
    caCertPath: env.PG_CA_CERT ?? null,
  };
}
