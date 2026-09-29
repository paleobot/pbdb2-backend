// PostgreSQL pool for the payload-schema tests. Same options as the migrations'
// src/lib/pg-pool.js, which payloadSchemas/ may not import. The pool is built on
// the first getPg() call, so a missing PG_* variable fails that test, not the file.
import 'dotenv/config';

import { readFileSync } from 'node:fs';
import { Pool } from 'pg';

const REQUIRED_VARS = ['PG_HOST', 'PG_USER', 'PG_PASSWORD', 'PG_DATABASE'];

let pool;

function getPg() {
  if (pool) return pool;
  const missing = REQUIRED_VARS.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    throw new Error(`Missing PG_* variables: ${missing.join(', ')}`);
  }
  pool = new Pool({
    host: process.env.PG_HOST,
    port: parseInt(process.env.PG_PORT || '5432', 10),
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    database: process.env.PG_DATABASE,
    max: 5,
    ssl: process.env.PG_CA_CERT ? { ca: readFileSync(process.env.PG_CA_CERT) } : undefined,
  });
  return pool;
}

async function closePg() {
  if (pool) await pool.end();
}

export { getPg, closePg };
