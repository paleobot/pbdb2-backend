import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

import { build } from './app.js';
import { loadConfig } from './config.js';

// Load the backend root's `.env` into process.env before anything reads config —
// the postgres plugin and loadConfig() rely on PG_* being present at build()
// time. Found from this file, not the working directory, so `npm start -w api`
// and `node src/server.js` from api/ read the same file. Variables already set
// in the environment win, and a missing file is fine (a deployed API).
dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });

const config = loadConfig();

// Fail loudly here (not in build()): a real server with no database would
// silently serve stub data, which is a misconfiguration, not a mode. build()
// stays tolerant so the in-process test suite can run without a database.
if (!config.pg.configured) {
  console.error(
    `Cannot start: missing required PostgreSQL env (${config.pg.missing.join(', ')}). ` +
      'Set them in .env (see .env.example).',
  );
  process.exit(1);
}

const app = build({ logger: true });

try {
  const address = await app.listen({ host: config.host, port: config.port });
  app.log.info(`PBDB2 API listening on ${address}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
