import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The backend repository root, where a relative PG_CA_CERT is resolved.
const BACKEND_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Configuration for the PBDB2 API.
 *
 * Reads from the environment with sensible defaults so the scaffold runs with
 * zero setup. Kept as a plain function (no @fastify/env yet) — a future change
 * can swap in schema-validated config if the surface grows.
 */
export function loadConfig(env = process.env) {
  const port = Number(env.PORT ?? 3000);
  return {
    host: env.HOST ?? '0.0.0.0',
    port,
    nodeEnv: env.NODE_ENV ?? 'development',
    publicBaseUrl: env.PUBLIC_BASE_URL || `http://localhost:${port}`,
    pg: loadPgConfig(env),
  };
}

/**
 * Validate and normalize the public base URL that every link in a response
 * starts with. It must be an absolute http(s) URL with no query, fragment or
 * credentials; a path is allowed, for a proxy that mounts the API under a
 * prefix and strips it before forwarding. The trailing `/` is removed, so an
 * absolute link is plain `base + path` for the root-relative paths the API
 * builds. Throws on anything else, so a misconfigured server fails at startup.
 *
 * @param {string} value
 * @returns {string} the base without a trailing slash
 */
export function normalizePublicBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`PUBLIC_BASE_URL must be an absolute URL, got ${JSON.stringify(value)}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`PUBLIC_BASE_URL must be http: or https:, got ${JSON.stringify(value)}`);
  }
  if (url.search || url.hash || url.username || url.password || /[?#]/.test(value)) {
    throw new Error(`PUBLIC_BASE_URL must carry no query, fragment or credentials, got ${JSON.stringify(value)}`);
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}

/**
 * PostgreSQL connection config, from the same PG_* variables the migrations
 * read: PG_HOST / PG_PORT / PG_USER / PG_PASSWORD / PG_DATABASE, with PG_CA_CERT
 * presence enabling SSL. A relative PG_CA_CERT resolves against the backend
 * repository root; an absolute one is used as given.
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
    caCertPath: env.PG_CA_CERT ? resolve(BACKEND_ROOT, env.PG_CA_CERT) : null,
  };
}
