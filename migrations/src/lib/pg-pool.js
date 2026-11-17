import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { Pool } from 'pg';

// The one .env and a relative PG_CA_CERT are both at the backend root, found from
// this file rather than the working directory.
const BACKEND_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
dotenv.config({ path: resolve(BACKEND_ROOT, '.env'), quiet: true });

const REQUIRED_VARS = ['PG_HOST', 'PG_USER', 'PG_PASSWORD', 'PG_DATABASE'];
const missing = REQUIRED_VARS.filter((v) => !process.env[v]);
if (missing.length > 0) {
  console.error(`Missing required .env variables: ${missing.join(', ')}`);
  process.exit(1);
}

const pgSsl = process.env.PG_CA_CERT
  ? { ca: readFileSync(resolve(BACKEND_ROOT, process.env.PG_CA_CERT)) }
  : undefined;

const pg = new Pool({
  host: process.env.PG_HOST,
  port: parseInt(process.env.PG_PORT || '5432', 10),
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
  max: 5,
  ssl: pgSsl,
});

async function closePg() {
  await pg.end();
}

export { pg, closePg };
