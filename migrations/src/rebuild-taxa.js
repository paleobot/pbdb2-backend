// Builds the four taxa ledgers (taxa_linnaean, taxa_clades, taxa_attachments,
// taxa) from the opinion tables by calling rebuild_taxa_full(), the supported
// entry point defined in db/03-taxa.sql. It is a derivation, not a migration:
// nothing is read from MariaDB or PBot, and re-running it upserts in place.
import { pg, closePg } from './lib/pg-pool.js';

async function main() {
  console.log('Calling rebuild_taxa_full()...');
  const started = Date.now();
  const { rows: [changed] } = await pg.query('SELECT * FROM rebuild_taxa_full()');
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`rebuild_taxa_full() finished in ${seconds}s`);
  for (const [column, n] of Object.entries(changed)) console.log(`  ${column}=${n}`);
}

main()
  .catch((err) => {
    console.error('rebuild-taxa failed:', err);
    process.exitCode = 1;
  })
  .finally(closePg);
