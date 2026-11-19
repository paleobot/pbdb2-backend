import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { build } from '../src/app.js';
import { MAX_LIMIT } from '../src/lib/list-filters.js';

/**
 * RIS reads end to end (ris-output), with no database: a fake postgres honours
 * the single-permid read, the ids set, the publicationType filter, the keyset
 * and the LIMIT, as csv-output.test.js's does. The export cap needs a real
 * socket, so that test listens on an ephemeral port.
 */

const RIS_TYPE = 'application/x-research-info-systems';
const RIS = { accept: RIS_TYPE };
const CONTENT_TYPE = 'application/x-research-info-systems; charset=utf-8';
const BASE = 'http://localhost:3000/api/v1/references';
const no = (permid) => Number(permid.split('-')[1]);

const refs = (n) =>
  Array.from({ length: n }, (_, i) => ({
    permid: `REF-${i + 1}-00`,
    payload: {
      title: `Reference ${i + 1}`,
      publicationType: i % 3 === 0 ? 'article in edited collection' : 'journal article',
      publicationYear: '2001',
      authors: [{ familyName: 'Smith', givenName: 'A.' }],
    },
  }));

function fakePg(rows, { hold } = {}) {
  const calls = [];
  return {
    calls,
    query: async (text, values) => {
      calls.push({ text, values });
      if (hold) await hold(calls.length, values);

      let out = [...rows].sort((a, b) => no(a.permid) - no(b.permid));
      if (/WHERE permid = \$1/.test(text)) out = out.filter((r) => r.permid === values[0]);
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

const get = (app, url, headers = RIS) => app.inject({ method: 'GET', url, headers });

/** The records of a RIS body, each as its lines without the ER line. */
function records(body) {
  if (body === '') return [];
  assert.ok(body.endsWith('ER  - \r\n\r\n'), 'the body ends with a complete record');
  return body
    .slice(0, -'ER  - \r\n\r\n'.length)
    .split('ER  - \r\n\r\n')
    .map((r) => r.split('\r\n').slice(0, -1));
}
const ids = (body) => records(body).map((lines) => lines.find((l) => l.startsWith('ID  - ')).slice(6));

test('RIS is selected on the list, an ids read and the single read', async (t) => {
  const app = build({ pg: fakePg(refs(5)) });
  t.after(() => app.close());

  const list = await get(app, '/api/v1/references');
  assert.equal(list.statusCode, 200);
  assert.equal(list.headers['content-type'], CONTENT_TYPE);
  assert.equal(list.headers.vary, 'Accept');
  assert.equal(list.headers['content-disposition'], 'attachment; filename="references.ris"');
  assert.deepEqual(ids(list.body), ['REF-1-00', 'REF-2-00', 'REF-3-00', 'REF-4-00', 'REF-5-00']);

  const some = await get(app, '/api/v1/references?ids=REF-2-00,REF-4-00,REF-99-00');
  assert.equal(some.statusCode, 200);
  assert.deepEqual(ids(some.body), ['REF-2-00', 'REF-4-00'], 'one record per permid found');
  assert.equal(some.headers.link, undefined, 'an ids read sends no Link');

  const one = await get(app, '/api/v1/references/REF-4-00');
  assert.equal(one.statusCode, 200);
  assert.equal(one.headers['content-type'], CONTENT_TYPE);
  assert.equal(one.headers.vary, 'Accept');
  assert.equal(one.headers['content-disposition'], 'attachment; filename="REF-4-00.ris"');
  const [record, ...rest] = records(one.body);
  assert.equal(rest.length, 0, 'exactly one record');
  assert.equal(record[0], 'TY  - CHAP');
  assert.ok(one.body.startsWith('TY  - '));
  assert.ok(one.body.endsWith('ER  - \r\n\r\n'));
  assert.ok(record.includes(`UR  - ${BASE}/REF-4-00`));
});

test('a wildcard or a tie gives JSON; RIS ranked above CSV gives RIS', async (t) => {
  const app = build({ pg: fakePg(refs(3)) });
  t.after(() => app.close());

  for (const accept of ['*/*', `${RIS_TYPE}, application/json`]) {
    for (const url of ['/api/v1/references', '/api/v1/references/REF-1-00']) {
      const res = await get(app, url, { accept });
      assert.equal(res.statusCode, 200, `${url} ${accept}`);
      assert.match(res.headers['content-type'], /^application\/json/, `${url} ${accept}`);
      assert.ok(res.json().data, `${url} ${accept}: the envelope`);
    }
  }

  const ranked = await get(app, '/api/v1/references', { accept: `${RIS_TYPE}, text/csv;q=0.5` });
  assert.equal(ranked.headers['content-type'], CONTENT_TYPE);
  const csv = await get(app, '/api/v1/references', { accept: `${RIS_TYPE};q=0.5, text/csv` });
  assert.match(csv.headers['content-type'], /^text\/csv/, 'CSV ranked above RIS still gives CSV');
});

test('only references offer RIS, and the reference single read still refuses CSV', async (t) => {
  const app = build();
  t.after(() => app.close());

  for (const url of ['/api/v1/authorities', '/api/v1/schemas', '/api/v1/collections/COL-1-00', '/api/v1/taxa']) {
    const res = await get(app, url);
    assert.equal(res.statusCode, 406, url);
    assert.equal(res.json().error.statusCode, 406, `${url}: the standard error shape`);
    const head = await app.inject({ method: 'HEAD', url, headers: RIS });
    assert.equal(head.statusCode, 406, `HEAD ${url}`);
  }

  const csv = await get(app, '/api/v1/references/REF-1-00', { accept: 'text/csv' });
  assert.equal(csv.statusCode, 406);
  assert.match(csv.json().error.message, /available as application\/json, application\/x-research-info-systems$/);
});

test('single read: a missing permid is a JSON 404, HEAD has no body, an unknown parameter is a 400', async (t) => {
  const pg = fakePg(refs(3));
  const app = build({ pg });
  t.after(() => app.close());

  const missing = await get(app, '/api/v1/references/REF-99-00');
  assert.equal(missing.statusCode, 404);
  assert.match(missing.headers['content-type'], /^application\/json/);
  assert.equal(missing.json().error.statusCode, 404);

  const head = await app.inject({ method: 'HEAD', url: '/api/v1/references/REF-2-00', headers: RIS });
  assert.equal(head.statusCode, 200);
  assert.equal(head.headers['content-type'], CONTENT_TYPE);
  assert.equal(head.headers['content-disposition'], 'attachment; filename="REF-2-00.ris"');
  assert.equal(head.body, '');

  const headMissing = await app.inject({ method: 'HEAD', url: '/api/v1/references/REF-99-00', headers: RIS });
  assert.equal(headMissing.statusCode, 404);

  const unknown = await get(app, '/api/v1/references/REF-2-00?limit=1');
  assert.equal(unknown.statusCode, 400);
  assert.match(unknown.headers['content-type'], /^application\/json/);
});

test('list: a limit is one page with Link; an invalid filter is a JSON 400; no matches is an empty 200', async (t) => {
  const app = build({ pg: fakePg(refs(25)) });
  t.after(() => app.close());

  const page = await get(app, '/api/v1/references?limit=10&publicationType=journal%20article');
  assert.equal(page.statusCode, 200);
  assert.equal(records(page.body).length, 10);
  const next = /<([^>]+)>; rel="next"/.exec(page.headers.link)?.[1];
  assert.ok(next, page.headers.link);
  assert.match(next, /^http:\/\/localhost:3000\/api\/v1\/references\?/);
  assert.match(next, /limit=10/);
  assert.match(next, /publicationType=journal\+article/);

  const bad = await get(app, '/api/v1/references?publicationType=nonsense');
  assert.equal(bad.statusCode, 400);
  assert.match(bad.headers['content-type'], /^application\/json/);

  const empty = await get(app, '/api/v1/references?publicationType=unpublished');
  assert.equal(empty.statusCode, 200);
  assert.equal(empty.headers['content-type'], CONTENT_TYPE);
  assert.equal(empty.body, '');
});

test('the whole result streams in permid order, each record once', async (t) => {
  const rows = refs(MAX_LIMIT + 50);
  const app = build({ pg: fakePg(rows) });
  t.after(() => app.close());

  const res = await get(app, '/api/v1/references');
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers.link, undefined);
  assert.deepEqual(ids(res.body), rows.map((r) => r.permid));
});

test('an unbounded RIS export shares the export cap with CSV', async (t) => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const pg = fakePg(refs(50), { hold: (_call, values) => (values.at(-1) === MAX_LIMIT + 1 ? held : undefined) });
  const app = build({ pg, maxConcurrentExports: 1 });
  t.after(() => app.close());
  await app.listen({ host: '127.0.0.1', port: 0 });
  const base = `http://127.0.0.1:${app.server.address().port}`;

  const csv = http.get(`${base}/api/v1/references`, { headers: { accept: 'text/csv' } });
  csv.on('error', () => {});
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(app.exports.running, 1, 'the CSV export holds the only slot');

  const refused = await new Promise((resolve, reject) => {
    http.get(`${base}/api/v1/references`, { headers: RIS }, resolve).once('error', reject);
  });
  assert.equal(refused.statusCode, 503);
  assert.equal(refused.headers['retry-after'], '30');
  assert.match(refused.headers['content-type'], /^application\/json/);
  refused.resume();

  csv.destroy();
  release();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(app.exports.running, 0);
});
