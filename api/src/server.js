import { build } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = build({ logger: true });

try {
  const address = await app.listen({ host: config.host, port: config.port });
  app.log.info(`PBDB2 API listening on ${address}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
