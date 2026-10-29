import { test } from 'node:test';
import assert from 'node:assert/strict';

import { build } from '../src/app.js';
import { DEFAULT_LIMIT, MAX_LIMIT } from '../src/lib/list-filters.js';
import { encodeCursor } from '../src/lib/cursor.js';

/**
 * Keyset pagination over the number in `permid` (`permid_no`), driven with NO database: the fake pg applies
 * the predicates the generated SQL actually declares, so paging is exercised
 * end-to-end (seam → repository → links) in-process.
 *
 * The reverse path is tested as a ROUND TRIP rather than in isolation — page
 * forward, then back — because the ways it breaks (an off-by-one at the
 * boundary, or forgetting to re-reverse the rows) both show up as a sequence
 * that fails to match, and neither shows up in a single-page assertion.
 */
const REFS = Array.from({ length: 12 }, (_, i) => ({
  permid: `REF-${(i + 1) * 10}-00`,
  payload: { title: `Reference ${i + 1}`, publicationType: i % 2 === 0 ? 'standalone book' : 'journal article' },
}));

/**
 * A fake postgres that honours the keyset predicate, the field filter, the
 * ORDER BY direction and the LIMIT — the parts pagination correctness depends
 * on. `rows` may be mutated between calls to simulate concurrent inserts.
 */
function fakeKeysetPg(rows = REFS) {
  const calls = [];
  return {
    calls,
    rows,
    query: async (text, values) => {
      calls.push({ text, values });

      let out = [...rows].sort((a, b) => no(a.permid) - no(b.permid));

      const idsParam = text.match(/permid = ANY\(\$(\d)\)/);
      if (idsParam) {
        const wanted = new Set(values[Number(idsParam[1]) - 1]);
        out = out.filter((r) => wanted.has(r.permid));
      }

      const typeParam = text.match(/->>'publicationType' = \$(\d)/);
      if (typeParam) {
        const wanted = values[Number(typeParam[1]) - 1];
        out = out.filter((r) => r.payload.publicationType === wanted);
      }

      const keyset = text.match(/permid_no ([<>]) \$(\d)/);
      if (keyset) {
        const boundary = Number(values[Number(keyset[2]) - 1]);
        out = out.filter((r) => (keyset[1] === '>' ? no(r.permid) > boundary : no(r.permid) < boundary));
      }

      if (/ORDER BY permid_no DESC/.test(text)) out.reverse();

      const limit = text.match(/LIMIT \$(\d)/);
      if (limit) out = out.slice(0, values[Number(limit[1]) - 1]);

      return { rows: out };
    },
  };
}

const permids = (body) => body.data.map((d) => d.permid);
// The number inside a permid, which lists order and seek on (the row's permid_no).
const no = (permid) => Number(permid.split('-')[1]);

test('first page: bounded by the default limit, ordered by permid, no prev link', async (t) => {
  const many = Array.from({ length: DEFAULT_LIMIT + 5 }, (_, i) => ({
    permid: `REF-${i + 1}-00`,
    payload: { title: `R${i}` },
  }));
  const app = build({ pg: fakeKeysetPg(many) });
  t.after(() => app.close());

  const body = (await app.inject({ method: 'GET', url: '/api/v1/references' })).json();
  assert.equal(body.data.length, DEFAULT_LIMIT, 'a bare list is bounded by the default');
  assert.deepEqual(permids(body), [...permids(body)].sort((a, b) => no(a) - no(b)), 'ordered by permid number');
  assert.equal(body.links.prev, null, 'the first page has no prev');
  assert.ok(body.links.next, 'a further page is offered');
  // Counts describe the page, not the full result set.
  assert.equal(body.meta.returned, DEFAULT_LIMIT);
  assert.equal('found' in body.meta, false, 'counts are page-scoped; no second count');
});

test('pagination links start with the configured base and can be followed', async (t) => {
  const base = 'https://pbdb2.example.org/base';
  const app = build({ pg: fakeKeysetPg(), publicBaseUrl: base });
  t.after(() => app.close());

  const first = (await app.inject({ method: 'GET', url: '/api/v1/references?limit=4' })).json();
  assert.ok(first.links.next.startsWith(`${base}/api/v1/references?`), first.links.next);
  assert.match(first.links.next, /limit=4/);

  // inject() takes the path; a client would request the URL as is.
  const path = (url) => url.slice(base.length);
  const second = (await app.inject({ method: 'GET', url: path(first.links.next) })).json();
  assert.ok(second.links.prev.startsWith(`${base}/api/v1/references?`), second.links.prev);
  assert.notDeepEqual(permids(second), permids(first));
});

test('forward paging walks every head exactly once, in order, then stops', async (t) => {
  const app = build({ pg: fakeKeysetPg() });
  t.after(() => app.close());

  const seen = [];
  const pages = [];
  let url = '/api/v1/references?limit=5';
  while (url) {
    const body = (await app.inject({ method: 'GET', url })).json();
    pages.push(permids(body));
    seen.push(...permids(body));
    url = body.links.next;
    assert.ok(pages.length <= 5, 'paging terminates');
  }

  assert.deepEqual(pages, [
    ['REF-10-00', 'REF-20-00', 'REF-30-00', 'REF-40-00', 'REF-50-00'],
    ['REF-60-00', 'REF-70-00', 'REF-80-00', 'REF-90-00', 'REF-100-00'],
    ['REF-110-00', 'REF-120-00'],
  ]);
  assert.deepEqual(seen, REFS.map((r) => r.permid), 'every head exactly once, in permid order');
  assert.equal(new Set(seen).size, seen.length, 'no repeats');
});

test('round trip: paging forward then back recovers the original sequence', async (t) => {
  const app = build({ pg: fakeKeysetPg() });
  t.after(() => app.close());

  const forward = [];
  let url = '/api/v1/references?limit=4';
  while (url) {
    const body = (await app.inject({ method: 'GET', url })).json();
    forward.push(permids(body));
    url = body.links.next;
  }
  assert.equal(forward.length, 3);

  // Walk back from the last page via `prev`, collecting the pages we land on.
  const backward = [];
  let body = (await app.inject({ method: 'GET', url: '/api/v1/references?limit=4' })).json();
  // Re-walk to the final page, then reverse out of it.
  while (body.links.next) {
    body = (await app.inject({ method: 'GET', url: body.links.next })).json();
  }
  backward.unshift(permids(body));
  while (body.links.prev) {
    body = (await app.inject({ method: 'GET', url: body.links.prev })).json();
    backward.unshift(permids(body));
    assert.ok(backward.length <= 4, 'reverse paging terminates');
  }

  assert.deepEqual(backward, forward, 'the reverse walk recovers the forward pages exactly');
  assert.deepEqual(
    backward.flat(),
    REFS.map((r) => r.permid),
    'and the whole sequence, still ascending',
  );
});

test('a backward page still offers the page it reversed out of', async (t) => {
  const app = build({ pg: fakeKeysetPg() });
  t.after(() => app.close());

  // Walk forward to the middle page, then step back one.
  const first = (await app.inject({ method: 'GET', url: '/api/v1/references?limit=4' })).json();
  const middle = (await app.inject({ method: 'GET', url: first.links.next })).json();
  assert.deepEqual(permids(middle), ['REF-50-00', 'REF-60-00', 'REF-70-00', 'REF-80-00']);

  const back = (await app.inject({ method: 'GET', url: middle.links.prev })).json();
  assert.deepEqual(permids(back), permids(first), 'stepping back lands on the first page');
  // `hasMore` on a backward read describes what lies BEHIND, so it must not be
  // what decides `next`: the page we reversed out of is still there.
  assert.equal(back.links.prev, null, 'and that page is the first, so prev is null');
  assert.ok(back.links.next, 'while next still leads forward again');

  const forwardAgain = (await app.inject({ method: 'GET', url: back.links.next })).json();
  assert.deepEqual(permids(forwardAgain), permids(middle), 'returning to where we came from');
});

test('the keyset SQL binds the right comparison, order and limit per direction', async (t) => {
  const pg = fakeKeysetPg();
  const app = build({ pg });
  t.after(() => app.close());

  await app.inject({ method: 'GET', url: '/api/v1/references?limit=3' });
  const first = pg.calls.at(-1);
  assert.match(first.text, /ORDER BY permid_no ASC LIMIT \$1/);
  assert.deepEqual(first.values, [4], 'limit + 1, to detect a further page without a second query');
  assert.doesNotMatch(first.text, /permid_no [<>] \$/, 'no keyset predicate without a cursor');

  const forward = encodeCursor({ permid: 'REF-30-00', direction: 'next' });
  await app.inject({ method: 'GET', url: `/api/v1/references?limit=3&cursor=${forward}` });
  const next = pg.calls.at(-1);
  assert.match(next.text, /permid_no > \$1 ORDER BY permid_no ASC LIMIT \$2/);
  assert.deepEqual(next.values, ['30', 4], 'the cursor permid binds as its number');

  const backward = encodeCursor({ permid: 'REF-90-00', direction: 'prev' });
  await app.inject({ method: 'GET', url: `/api/v1/references?limit=3&cursor=${backward}` });
  const prev = pg.calls.at(-1);
  assert.match(prev.text, /permid_no < \$1 ORDER BY permid_no DESC LIMIT \$2/);
  assert.deepEqual(prev.values, ['90', 4]);
});

test('pagination composes with a field filter, and next preserves it', async (t) => {
  const app = build({ pg: fakeKeysetPg() });
  t.after(() => app.close());

  const body = (
    await app.inject({ method: 'GET', url: '/api/v1/references?publicationType=standalone%20book&limit=3' })
  ).json();
  assert.deepEqual(permids(body), ['REF-10-00', 'REF-30-00', 'REF-50-00'], 'only matching heads');
  // URLSearchParams writes the space as '+'; the loop below follows it, so the
  // server must read it back as 'standalone book'.
  assert.match(body.links.next, /publicationType=standalone\+book/, 'the filter survives into next');
  assert.match(body.links.next, /limit=3/, 'so does the page size');

  // Paging through yields exactly the filtered set.
  const seen = [];
  let url = '/api/v1/references?publicationType=standalone%20book&limit=3';
  while (url) {
    const page = (await app.inject({ method: 'GET', url })).json();
    seen.push(...permids(page));
    url = page.links.next;
  }
  assert.deepEqual(seen, REFS.filter((r) => r.payload.publicationType === 'standalone book').map((r) => r.permid));
});

test('malformed limit and cursor are rejected with 400', async (t) => {
  const app = build({ pg: fakeKeysetPg() });
  t.after(() => app.close());

  for (const value of ['', '0', '-3', 'abc', '1.5', '1e3', String(MAX_LIMIT + 1)]) {
    const res = await app.inject({ method: 'GET', url: `/api/v1/references?limit=${value}` });
    assert.equal(res.statusCode, 400, `limit=${value} must be rejected`);
    assert.equal(res.json().error.statusCode, 400, 'in the standard error shape');
  }

  const res = await app.inject({ method: 'GET', url: '/api/v1/references?cursor=not-a-cursor' });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error.message, /cursor/);

  // A well-encoded cursor whose permid is not a permid: its number can't be read.
  for (const permid of ['ref-03', 'REF-030-00', 'REF--00', 'REF-30']) {
    const forged = encodeCursor({ permid, direction: 'next' });
    const bad = await app.inject({ method: 'GET', url: `/api/v1/references?cursor=${forged}` });
    assert.equal(bad.statusCode, 400, `cursor permid ${permid} must be rejected`);
  }

  // The boundary value itself is accepted.
  const ok = await app.inject({ method: 'GET', url: `/api/v1/references?limit=${MAX_LIMIT}` });
  assert.equal(ok.statusCode, 200);
});

test('ids combined with limit or cursor is rejected with 400', async (t) => {
  const app = build({ pg: fakeKeysetPg() });
  t.after(() => app.close());

  const cursor = encodeCursor({ permid: 'REF-10-00', direction: 'next' });
  for (const query of [`ids=REF-10-00,REF-20-00&limit=10`, `ids=REF-10-00,REF-20-00&cursor=${cursor}`]) {
    const res = await app.inject({ method: 'GET', url: `/api/v1/references?${query}` });
    assert.equal(res.statusCode, 400, `${query} must be rejected`);
    assert.match(res.json().error.message, /ids/);
  }
});

test('an ids read keeps its accounting and carries null pagination links', async (t) => {
  const app = build({ pg: fakeKeysetPg() });
  t.after(() => app.close());

  const body = (
    await app.inject({ method: 'GET', url: '/api/v1/references?ids=REF-10-00,REF-20-00,nope' })
  ).json();
  assert.deepEqual(permids(body), ['REF-10-00', 'REF-20-00']);
  assert.equal(body.meta.requested, 3);
  assert.deepEqual(body.meta.missing, ['nope']);
  assert.equal(body.links.next, null);
  assert.equal(body.links.prev, null);
});

test('a stub-backed resource accepts limit and is its own single page', async (t) => {
  const app = build({ pg: fakeKeysetPg() });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/api/v1/specimens?limit=5' });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.data.length, 1);
  assert.equal(body.links.next, null);
  assert.equal(body.links.prev, null);
});

test('a row inserted between pages skips or repeats nothing that was already there', async (t) => {
  const rows = REFS.slice(0, 6).map((r) => ({ ...r }));
  const pg = fakeKeysetPg(rows);
  const app = build({ pg });
  t.after(() => app.close());

  const first = (await app.inject({ method: 'GET', url: '/api/v1/references?limit=3' })).json();
  assert.deepEqual(permids(first), ['REF-10-00', 'REF-20-00', 'REF-30-00']);

  // Two inserts land between the requests: one behind the cursor, one ahead.
  rows.push({ permid: 'REF-25-00', payload: { title: 'inserted behind' } });
  rows.push({ permid: 'REF-70-00', payload: { title: 'inserted ahead' } });

  const seen = [...permids(first)];
  let url = first.links.next;
  while (url) {
    const page = (await app.inject({ method: 'GET', url })).json();
    seen.push(...permids(page));
    url = page.links.next;
  }

  assert.equal(new Set(seen).size, seen.length, 'nothing is returned twice');
  for (const original of REFS.slice(0, 6)) {
    assert.ok(seen.includes(original.permid), `${original.permid} was not skipped`);
  }
  // The keyset names a position, so only the insert ahead of it can appear;
  // the one behind is simply not part of any later page.
  assert.ok(seen.includes('REF-70-00'));
  assert.ok(!seen.includes('REF-25-00'));
});
