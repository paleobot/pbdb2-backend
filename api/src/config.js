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
  };
}
