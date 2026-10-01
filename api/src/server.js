// Load `.env` into process.env before anything reads config — the postgres
// plugin and loadConfig() rely on PG_* being present at build() time. Must be
// the first import so the env is populated before config is evaluated.
import 'dotenv/config';

import { build } from './app.js';
import { loadConfig } from './config.js';

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
