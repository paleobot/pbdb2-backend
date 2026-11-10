import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { build } from '../src/app.js';
import { MAX_LIMIT } from '../src/lib/list-filters.js';
import { encodeCursor } from '../src/lib/cursor.js';
import { readCsv } from './csv-parse.js';
import { loadConfig, parseMaxConcurrentExports } from '../src/config.js';

/**
 * CSV list reads end to end (csv-output), with no database: a fake postgres
 * honours the keyset predicate, the publicationType filter, the ids set, the
 * order and the LIMIT, as in pagination.test.js. Streaming, disconnects and the
 * export cap need a real socket, so those tests listen on an ephemeral port.
 */

const CSV = { accept: 'text/csv' };
const no = (permid) => Number(permid.split('-')[1]);

const refs = (n) =>
  Array.from({ length: n }, (_, i) => ({
    permid: `REF-${i + 1}-00`,
    payload: {
      title: `Reference ${i + 1}`,
      publicationType: i % 3 === 0 ? 'standalone book' : 'journal article',
      authors: [{ familyName: 'Smith', givenName: 'A' }, { familyName: 'Jones' }],
    },
  }));

/**
 * A fake postgres. `hold(call)` may return a promise the query waits for, and
 * `fail(call)` may throw, each given the 1-based number of this query.
 */
function fakePg(rows, { hold, fail } = {}) {
  const calls = [];
  return {
    calls,
    query: async (text, values) => {
      calls.push({ text, values });
      const call = calls.length;
      if (hold) await hold(call, values);
      if (fail?.(call)) throw new Error(`query ${call} failed`);

      let out = [...rows].sort((a, b) => no(a.permid) - no(b.permid));
      const ids = text.match(/permid = ANY\(\$(\d)\)/);
      if (ids) {
        const wanted = new Set(values[Number(ids[1]) - 1]);
        out = out.filter((r) => wanted.has(r.permid));
      }
      const type = text.match(/->>'publicationType' = \$(\d)/);
      if (type) out = out.filter((r) => r.payload.publicationType === values[Number(type[1]) - 1]);
      const keyset = text.match(/permid_no ([<>]) \$(\d)/);
      if (keyset) {
        const at = Number(values[Number(keyset[2]) - 1]);
        out = out.filter((r) => (keyset[1] === '>' ? no(r.permid) > at : no(r.permid) < at));
      }
      if (/ORDER BY permid_no DESC/.test(text)) out.reverse();
      const limit = text.match(/LIMIT \$(\d)/);
      if (limit) out = out.slice(0, values[Number(limit[1]) - 1]);
      return { rows: out };
    },
  };
}

const get = (app, url, headers = CSV) => app.inject({ method: 'GET', url, headers });
const permids = (res) => readCsv(res.body).records.map((r) => r.permid);
/** The page queries a request made: each asks for one more than its page. */
const batchLimits = (pg) => pg.calls.map((c) => c.values.at(-1));

test('the whole result, in order, each record once, in batches of the maximum page size', async (t) => {
  const rows = refs(MAX_LIMIT * 2 + 500);
  const pg = fakePg(rows);
  const app = build({ pg });
  t.after(() => app.close());

  const res = await get(app, '/api/v1/references');
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'text/csv; charset=utf-8; header=present');
  assert.equal(res.headers.link, undefined, 'an unbounded export names no pages');
  assert.deepEqual(permids(res), rows.map((r) => r.permid));
  assert.deepEqual(batchLimits(pg), [MAX_LIMIT + 1, MAX_LIMIT + 1, MAX_LIMIT + 1]);

  const [first] = readCsv(res.body).records;
  assert.equal(first['authors.familyName'], 'Smith|Jones');
  assert.equal(first['authors.givenName'], 'A|');
});

test('the header does not vary with the filter, and an empty result is the header alone', async (t) => {
  const app = build({ pg: fakePg(refs(10)) });
  t.after(() => app.close());

  const books = await get(app, '/api/v1/references?publicationType=standalone%20book');
  const articles = await get(app, '/api/v1/references?publicationType=journal%20article');
  assert.deepEqual(readCsv(books.body).header, readCsv(articles.body).header);
  assert.deepEqual(permids(books), ['REF-1-00', 'REF-4-00', 'REF-7-00', 'REF-10-00'], 'the filter narrows the export');

  const empty = await get(app, '/api/v1/references?publicationType=unpublished');
  assert.equal(empty.statusCode, 200);
  assert.equal(empty.body, books.body.slice(0, books.body.indexOf('\r\n') + 2));
});

test('a limit means one page, with further pages in the Link header', async (t) => {
  const app = build({ pg: fakePg(refs(25)) });
  t.after(() => app.close());

  const first = await get(app, '/api/v1/references?limit=10&publicationType=journal%20article');
  assert.equal(permids(first).length, 10);
  const next = /<([^>]+)>; rel="next"/.exec(first.headers.link)?.[1];
  assert.ok(next, first.headers.link);
  assert.match(next, /^http:\/\/localhost:3000\/api\/v1\/references\?/);
  assert.match(next, /limit=10/);
  assert.match(next, /publicationType=journal\+article/);
  assert.doesNotMatch(first.headers.link, /rel="prev"/, 'the first page has no prev');

  const second = await get(app, new URL(next).pathname + new URL(next).search);
  assert.match(second.headers.link, /rel="prev"/);

  const all = await get(app, '/api/v1/references?limit=100');
  assert.equal(permids(all).length, 25);
  assert.equal(all.headers.link, undefined, 'one page holding everything names no pages');

  const big = await get(app, `/api/v1/references?limit=${MAX_LIMIT + 1}`);
  assert.equal(big.statusCode, 400);
  assert.match(big.headers['content-type'], /^application\/json/);
});

test('a forward cursor without limit streams from there; a backward one is a 400', async (t) => {
  const app = build({ pg: fakePg(refs(30)) });
  t.after(() => app.close());

  const forward = encodeCursor({ permid: 'REF-20-00', direction: 'next' });
  const res = await get(app, `/api/v1/references?cursor=${forward}`);
  assert.deepEqual(permids(res), refs(30).slice(20).map((r) => r.permid));

  const backward = encodeCursor({ permid: 'REF-20-00', direction: 'prev' });
  const bad = await get(app, `/api/v1/references?cursor=${backward}`);
  assert.equal(bad.statusCode, 400);
  assert.match(bad.json().error.message, /limit/);

  const paged = await get(app, `/api/v1/references?cursor=${backward}&limit=5`);
  assert.deepEqual(permids(paged), ['REF-15-00', 'REF-16-00', 'REF-17-00', 'REF-18-00', 'REF-19-00']);
});

test('an ids read returns the found records with no Link and no accounting', async (t) => {
  const app = build({ pg: fakePg(refs(5)) });
  t.after(() => app.close());

  const res = await get(app, '/api/v1/references?ids=REF-2-00,REF-4-00,REF-99-00');
  assert.equal(res.statusCode, 200);
  assert.deepEqual(permids(res), ['REF-2-00', 'REF-4-00']);
  assert.equal(res.headers.link, undefined);
});

test('errors stay JSON, an expansion is refused, and HEAD reads one batch', async (t) => {
  const pg = fakePg(refs(MAX_LIMIT * 3));
  const app = build({ pg });
  t.after(() => app.close());

  const bad = await get(app, '/api/v1/references?publicationType=nonsense');
  assert.equal(bad.statusCode, 400);
  assert.match(bad.headers['content-type'], /^application\/json/);

  // No database for taxa: the expansion is refused before any read.
  const expansion = await get(build(), '/api/v1/taxa?includeContainingTaxa=true');
  assert.equal(expansion.statusCode, 400);
  assert.match(expansion.json().error.message, /includeContainingTaxa/);

  const before = pg.calls.length;
  const head = await app.inject({ method: 'HEAD', url: '/api/v1/references', headers: CSV });
  assert.equal(head.statusCode, 200);
  assert.match(head.headers['content-type'], /^text\/csv/);
  assert.equal(head.body, '');
  assert.equal(pg.calls.length - before, 1, 'one batch, not the whole export');
});

test('MAX_CONCURRENT_EXPORTS is a positive integer, or absent for the default', () => {
  assert.equal(parseMaxConcurrentExports(undefined), undefined);
  assert.equal(parseMaxConcurrentExports(''), undefined);
  assert.equal(parseMaxConcurrentExports('8'), 8);
  for (const bad of ['0', '-1', '2.5', 'four', ' 3']) {
    assert.throws(() => parseMaxConcurrentExports(bad), /MAX_CONCURRENT_EXPORTS/, bad);
  }
  assert.equal(loadConfig({ MAX_CONCURRENT_EXPORTS: '6' }).maxConcurrentExports, 6);
  assert.equal(build().exports.max, 4, 'the default');
});

/** Listen on an ephemeral port; resolves to the base URL. */
async function listen(app) {
  await app.listen({ host: '127.0.0.1', port: 0 });
  return `http://127.0.0.1:${app.server.address().port}`;
}

/** A GET over a socket: the response, the body as it arrives, and how it ended. */
function request(url, headers = CSV) {
  let res;
  let body = '';
  const req = http.get(url, { headers });
  const responded = new Promise((resolve, reject) => {
    req.once('response', (r) => { res = r; resolve(r); });
    req.once('error', reject);
  });
  const ended = responded.then(
    () =>
      new Promise((resolve) => {
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.once('end', () => resolve({ complete: res.complete, body }));
        res.once('error', () => resolve({ complete: false, body }));
        res.once('aborted', () => resolve({ complete: false, body }));
      }),
  );
  // A test that disconnects a request on purpose never awaits these.
  responded.catch(() => {});
  ended.catch(() => {});
  return { req, responded, ended, body: () => body };
}

const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

/** A promise and the function that settles it. */
function gate() {
  let open;
  const promise = new Promise((resolve) => { open = resolve; });
  return { promise, open };
}

test('a failure after the response starts aborts the connection', async (t) => {
  const pg = fakePg(refs(MAX_LIMIT * 3), { fail: (call) => call === 2 });
  const app = build({ pg });
  t.after(() => app.close());
  const base = await listen(app);

  const { responded, ended } = request(`${base}/api/v1/references`);
  assert.equal((await responded).statusCode, 200, 'the first batch succeeded');
  const result = await ended;
  assert.equal(result.complete, false, 'the body is not ended as if complete');
  assert.ok(readCsvLines(result.body) <= MAX_LIMIT + 1);
});

/** Complete lines received, header included. */
const readCsvLines = (body) => body.split('\r\n').length - 1;

test('a client that disconnects causes no further batch queries', async (t) => {
  const second = gate();
  const pg = fakePg(refs(MAX_LIMIT * 4), { hold: (call) => (call === 2 ? second.promise : undefined) });
  const app = build({ pg });
  t.after(() => app.close());
  const base = await listen(app);

  const { req, responded } = request(`${base}/api/v1/references`);
  await responded;
  await tick();
  assert.equal(pg.calls.length, 2, 'the second batch is in flight');

  req.destroy();
  await tick();
  second.open();
  await tick(50);
  assert.equal(pg.calls.length, 2, 'nothing after the disconnect');
});

test('unbounded exports are capped per instance; a slot is freed on disconnect', async (t) => {
  // Every unbounded batch waits on `held` until it opens; a page of 10 does not.
  const held = gate();
  const pg = fakePg(refs(50), { hold: (_call, values) => (values.at(-1) === MAX_LIMIT + 1 ? held.promise : undefined) });
  const app = build({ pg, maxConcurrentExports: 1 });
  t.after(() => app.close());
  const base = await listen(app);

  const first = request(`${base}/api/v1/references`);
  await tick();
  assert.equal(app.exports.running, 1);

  const refused = request(`${base}/api/v1/references`);
  const res = await refused.responded;
  assert.equal(res.statusCode, 503);
  assert.equal(res.headers['retry-after'], '30');
  assert.match(res.headers['content-type'], /^application\/json/);

  const page = await request(`${base}/api/v1/references?limit=10`).responded;
  assert.equal(page.statusCode, 200, 'a bounded read does not count');

  // Disconnect while the first export's batch is still held: that frees its slot.
  first.req.destroy();
  await tick(50);
  assert.equal(app.exports.running, 0, 'the slot was released on disconnect');
  held.open();

  const head = await new Promise((resolve, reject) => {
    const req = http.request(`${base}/api/v1/references`, { method: 'HEAD', headers: CSV }, resolve);
    req.once('error', reject);
    req.end();
  });
  assert.equal(head.statusCode, 200);
  assert.equal(app.exports.running, 0, 'HEAD takes no slot');

  const again = request(`${base}/api/v1/references`);
  assert.equal((await again.responded).statusCode, 200);
  const done = await again.ended;
  assert.equal(done.complete, true);
  assert.equal(readCsvLines(done.body), 51);
  await tick();
  assert.equal(app.exports.running, 0, 'and released again when it finishes');
});
