import { test } from 'node:test';
import assert from 'node:assert/strict';

import { build } from '../src/app.js';

/**
 * Per-entity field filters on `references` (publication_type). The fake pg
 * actually applies whatever predicates the generated SQL declares — parsing the
 * `permid = ANY($n)` and `->>'publicationType' = $n` clauses out of the query
 * text and binding from `values` — so these exercise the full define → validate
 * → translate path, not a stubbed result.
 */
function fakeRefsPg(table) {
  const calls = [];
  return {
    calls,
    query: async (text, values = []) => {
      calls.push({ text, values });

      let rows = Object.entries(table).map(([permid, payload]) => ({ permid, payload }));

      const idsClause = text.match(/permid = ANY\(\$(\d+)\)/);
      if (idsClause) {
        const ids = values[Number(idsClause[1]) - 1];
        rows = rows.filter((r) => ids.includes(r.permid));
      }

      const ptClause = text.match(/->>'publicationType' = \$(\d+)/);
      if (ptClause) {
        const want = values[Number(ptClause[1]) - 1];
        rows = rows.filter((r) => r.payload.publicationType === want);
      }

      rows.sort((a, b) => (a.permid < b.permid ? -1 : 1));
      return { rows };
    },
  };
}

const REFS = {
  'ref-1': { title: 'A', publicationType: 'book' },
  'ref-2': { title: 'B', publicationType: 'journal article' },
  'ref-3': { title: 'C', publicationType: 'book' },
};

test('references filtered by publication_type returns only matching heads', async (t) => {
  const pg = fakeRefsPg(REFS);
  const app = build({ pg });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/api/v1/references?publication_type=book' });
  assert.equal(res.statusCode, 200);

  const body = res.json();
  assert.deepEqual(
    body.data.map((d) => d.permid),
    ['ref-1', 'ref-3'],
  );

  // The filter translates to a parameterized JSONB predicate under the head filter.
  const q = pg.calls.find((c) => /->>'publicationType' = \$1/.test(c.text));
  assert.ok(q, 'a publicationType-bound query ran');
  assert.match(q.text, /succeeded_by_id IS NULL/);
  assert.deepEqual(q.values, ['book']);
});

test('field filter composes with ids in a single WHERE', async (t) => {
  const pg = fakeRefsPg(REFS);
  const app = build({ pg });
  t.after(() => app.close());

  // ref-1 (book, in ids) matches; ref-2 (journal, in ids) filtered out;
  // ref-3 (book, not in ids) excluded.
  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/references?ids=ref-1,ref-2&publication_type=book',
  });
  assert.equal(res.statusCode, 200);

  const body = res.json();
  assert.deepEqual(
    body.data.map((d) => d.permid),
    ['ref-1'],
  );
  // Composing a field filter makes this a filtered query, so the multi-get
  // partial-success accounting is suppressed — `missing` can't distinguish
  // "no head" from "filtered out".
  assert.equal(body.meta.requested, undefined);
  assert.equal(body.meta.missing, undefined);

  const q = pg.calls.find((c) => c.text.includes('permid = ANY($1)'));
  assert.ok(q, 'a composed query ran');
  assert.match(q.text, /permid = ANY\(\$1\)/);
  assert.match(q.text, /->>'publicationType' = \$2/);
  assert.deepEqual(q.values, [['ref-1', 'ref-2'], 'book']);
});

test('field filter with no match is an empty 200 with no missing accounting', async (t) => {
  const pg = fakeRefsPg(REFS);
  const app = build({ pg });
  t.after(() => app.close());

  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/references?publication_type=guidebook',
  });
  assert.equal(res.statusCode, 200);

  const body = res.json();
  assert.deepEqual(body.data, []);
  assert.equal(body.meta.found, 0);
  assert.equal(body.meta.missing, undefined, 'field filters produce no missing accounting');
});

test('empty publication_type value is a 400', async (t) => {
  const pg = fakeRefsPg(REFS);
  const app = build({ pg });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/api/v1/references?publication_type=' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.statusCode, 400);
});

test('unknown query param is ignored — no filtering, no 400', async (t) => {
  const pg = fakeRefsPg(REFS);
  const app = build({ pg });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/api/v1/references?colour=blue' });
  assert.equal(res.statusCode, 200, 'an unrecognized param is not rejected');

  const body = res.json();
  assert.equal(body.data.length, 3, 'the unknown param did not filter the result');
  // No field predicate reached SQL.
  assert.ok(!pg.calls.some((c) => /->>'/.test(c.text)), 'no JSONB field predicate was built');
});

test('regression: bare list and ids-only multi-get still behave through the unified read', async (t) => {
  const pg = fakeRefsPg(REFS);
  const app = build({ pg });
  t.after(() => app.close());

  const all = (await app.inject({ method: 'GET', url: '/api/v1/references' })).json();
  assert.deepEqual(
    all.data.map((d) => d.permid),
    ['ref-1', 'ref-2', 'ref-3'],
  );

  const subset = (
    await app.inject({ method: 'GET', url: '/api/v1/references?ids=ref-1,ghost' })
  ).json();
  assert.deepEqual(
    subset.data.map((d) => d.permid),
    ['ref-1'],
  );
  assert.equal(subset.meta.requested, 2);
  assert.deepEqual(subset.meta.missing, ['ghost']);
});
