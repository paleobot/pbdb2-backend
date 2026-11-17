// One-off audit of Classic DOIs: resolves each through Crossref, else doi.org, and
// writes a verdict per ref to inputs/doi-verdicts.csv, which migrate-refs.js reads.
// Not a migration and not a runner step: it calls outside services, the migration doesn't.
//
//   node src/refs-migration/audit-dois.js            incremental: new or changed DOIs only
//   node src/refs-migration/audit-dois.js --all      re-resolve every DOI
//   node src/refs-migration/audit-dois.js --rescore  no network: recompute verdicts from stored metadata
//
// Requests carry a generic User-Agent and no contact details, so Crossref serves them
// from its public pool: sequential, at most 4 per second.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeDoi, isWellFormedDoi, verdictRow, resolutionOf, readVerdictFile, writeVerdictFile,
} from './dois.js';

export const VERDICT_FILE = join(dirname(fileURLToPath(import.meta.url)), 'inputs', 'doi-verdicts.csv');
export const USER_AGENT = 'pbdb2-doi-audit/1.0';
const MIN_INTERVAL_MS = 250;
const MAX_RETRIES = 5;
const TIMEOUT_MS = 30_000; // a timed-out request counts as a network error
const MAX_THROTTLE_WAITS = 10;
const CHECKPOINT_EVERY = 500;

export class RetriesExhausted extends Error {}

const clean = (s) => (s ?? '').toString().replace(/\s+/g, ' ').trim();
const first = (v) => (Array.isArray(v) ? v[0] : v);
const yearFrom = (date) => date?.['date-parts']?.[0]?.[0] ?? '';
const firstAuthor = (authors) => clean(authors?.[0]?.family ?? authors?.[0]?.name ?? authors?.[0]?.literal);

// Crossref's `message` and CSL JSON share these field names.
export function metadataFrom(work, source) {
  const title = clean(first(work.title));
  const subtitle = clean(first(work.subtitle));
  return {
    source,
    title: subtitle ? `${title}: ${subtitle}` : title,
    container: clean(first(work['container-title'])),
    year: yearFrom(work.issued) || yearFrom(work.published) || yearFrom(work['published-print']) || '',
    firstAuthor: firstAuthor(work.author),
  };
}

// fetchFn and sleep are injectable for tests.
export function createResolver({ fetchFn = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let lastStart = 0;
  let requests = 0;

  async function request(url, accept) {
    let failures = 0;
    let throttles = 0;
    for (;;) {
      const wait = lastStart + MIN_INTERVAL_MS - Date.now();
      if (wait > 0) await sleep(wait);
      lastStart = Date.now();
      requests++;
      let res;
      try {
        res = await fetchFn(url, { headers: { 'User-Agent': USER_AGENT, Accept: accept }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch {
        if (++failures > MAX_RETRIES) throw new RetriesExhausted(`network errors: ${url}`);
        await sleep(2000 * 2 ** (failures - 1));
        continue;
      }
      if (res.status === 429 || res.status === 503) {
        if (++throttles > MAX_THROTTLE_WAITS) throw new RetriesExhausted(`throttled: ${url}`);
        const retryAfter = Number(res.headers.get('retry-after'));
        await sleep(retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** (throttles - 1));
        continue;
      }
      if (res.status >= 500) {
        if (++failures > MAX_RETRIES) throw new RetriesExhausted(`HTTP ${res.status}: ${url}`);
        await sleep(2000 * 2 ** (failures - 1));
        continue;
      }
      return res;
    }
  }

  // { source, title, container, year, firstAuthor } for a well-formed normalized DOI.
  async function resolve(doi) {
    const path = encodeURIComponent(doi);
    const cr = await request(`https://api.crossref.org/works/${path}`, 'application/json');
    if (cr.status === 200) return metadataFrom((await cr.json()).message, 'crossref');
    if (cr.status !== 404) throw new RetriesExhausted(`Crossref HTTP ${cr.status}: ${doi}`);

    const h = await request(`https://doi.org/api/handles/${path}`, 'application/json');
    const code = (await h.json().catch(() => ({}))).responseCode;
    if (code === 100) return { source: 'none', title: '', container: '', year: '', firstAuthor: '' };
    if (code !== 1) throw new RetriesExhausted(`handle API responseCode ${code} (HTTP ${h.status}): ${doi}`);

    const cn = await request(`https://doi.org/${path}`, 'application/vnd.citationstyles.csl+json');
    if (cn.ok && /json/.test(cn.headers.get('content-type') ?? '')) {
      const work = await cn.json().catch(() => null);
      if (work) return metadataFrom(work, 'doi.org');
    }
    return { source: 'handle', title: '', container: '', year: '', firstAuthor: '' };
  }

  return { resolve, requestCount: () => requests };
}

// The refs to audit: all with --all, otherwise those with no row or a row for another DOI.
export function selectForAudit(refs, rows, all) {
  return refs.filter((ref) => all || rows.get(ref.reference_no)?.source_doi !== ref.doi.trim());
}

function verdictCounts(rows) {
  const counts = {};
  for (const row of rows.values()) counts[row.verdict] = (counts[row.verdict] ?? 0) + 1;
  return counts;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const all = args.has('--all');
  const rescore = args.has('--rescore');
  if (all && rescore) throw new Error('--all and --rescore are exclusive');
  const start = Date.now();
  const mode = all ? 'all' : rescore ? 'rescore' : 'incremental';
  console.log(`[${new Date(start).toISOString()}] DOI audit (${mode})`);

  const { mariadb, closeMariadb } = await import('../lib/mariadb-pool.js');
  let refs;
  try {
    const [rows] = await mariadb.query(
      `SELECT reference_no, doi, reftitle, pubtitle, pubyr, author1last FROM refs WHERE doi IS NOT NULL ORDER BY reference_no`,
    );
    refs = rows.filter((r) => r.doi.trim());
  } finally {
    await closeMariadb();
  }
  console.log(`  ${refs.length} Classic refs with a DOI`);

  const rows = existsSync(VERDICT_FILE) ? readVerdictFile(VERDICT_FILE) : new Map();
  const withDoi = new Set(refs.map((r) => r.reference_no));
  let pruned = 0;
  for (const refNo of rows.keys()) if (!withDoi.has(refNo)) { rows.delete(refNo); pruned++; }
  console.log(`  ${rows.size} existing rows kept, ${pruned} removed (ref no longer has a DOI)`);

  if (rescore) {
    let rescored = 0;
    for (const ref of refs) {
      const row = rows.get(ref.reference_no);
      if (!row || row.source_doi !== ref.doi.trim()) continue;
      if (row.source !== 'crossref' && row.source !== 'doi.org') continue;
      rows.set(ref.reference_no, verdictRow(ref, resolutionOf(row)));
      rescored++;
    }
    writeVerdictFile(VERDICT_FILE, rows.values());
    console.log(`  Rescored ${rescored} rows`);
  } else {
    const toAudit = selectForAudit(refs, rows, all);
    const byDoi = new Map();
    let malformed = 0;
    for (const ref of toAudit) {
      const doi = normalizeDoi(ref.doi);
      if (!isWellFormedDoi(doi)) { rows.set(ref.reference_no, verdictRow(ref, null)); malformed++; continue; }
      const key = doi.toLowerCase();
      if (!byDoi.has(key)) byDoi.set(key, { doi, refs: [] });
      byDoi.get(key).refs.push(ref);
    }
    console.log(`  Auditing ${toAudit.length} refs: ${malformed} malformed, ${byDoi.size} distinct DOIs to resolve`);

    const resolver = createResolver();
    let resolved = 0;
    let failedDois = 0;
    let failedRefs = 0;
    for (const { doi, refs: sharing } of byDoi.values()) {
      try {
        const resolution = await resolver.resolve(doi);
        for (const ref of sharing) rows.set(ref.reference_no, verdictRow(ref, resolution));
      } catch (err) {
        if (!(err instanceof RetriesExhausted)) throw err;
        console.warn(`  FAILED ${doi}: ${err.message}`);
        failedDois++;
        failedRefs += sharing.length;
      }
      if (++resolved % CHECKPOINT_EVERY === 0) {
        writeVerdictFile(VERDICT_FILE, rows.values());
        const rate = resolved / ((Date.now() - start) / 1000);
        console.log(`  ${resolved}/${byDoi.size} DOIs (${rate.toFixed(1)}/s), checkpoint written`);
      }
    }
    writeVerdictFile(VERDICT_FILE, rows.values());
    console.log(`  Failed: ${failedDois} DOIs (${failedRefs} refs), no row written for them`);
    console.log(`  HTTP requests: ${resolver.requestCount()}`);
  }

  console.log(`  Rows: ${rows.size}`);
  for (const [verdict, n] of Object.entries(verdictCounts(rows)).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${verdict}: ${n}`);
  }
  console.log(`  Elapsed ${((Date.now() - start) / 1000).toFixed(0)}s`);
}

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((err) => {
    console.error('DOI audit failed:', err);
    process.exitCode = 1;
  });
}
