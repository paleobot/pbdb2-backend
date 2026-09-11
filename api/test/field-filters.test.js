import { test } from 'node:test';
import assert from 'node:assert/strict';

import { build } from '../src/app.js';
import { DEFAULT_LIMIT } from '../src/lib/list-filters.js';

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
  assert.deepEqual(q.values, ['book', DEFAULT_LIMIT + 1]);
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
  assert.deepEqual(q.values, [['ref-1', 'ref-2'], 'book', DEFAULT_LIMIT + 1]);
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

test('unknown query param is rejected with a 400 naming it', async (t) => {
  // This reverses the previous leniency, under which the param was ignored and
  // the request returned an unfiltered 200 — a response indistinguishable from
  // "everything matched". See the add-taxa-reads design.md.
  const pg = fakeRefsPg(REFS);
  const app = build({ pg });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/api/v1/references?colour=blue' });
  assert.equal(res.statusCode, 400, 'an unrecognized param is rejected');
  assert.match(res.json().error.message, /colour/, 'the error names the offending param');
  // The request never reached the database.
  assert.equal(pg.calls.length, 0, 'no query was issued for a rejected request');
});

test('an unknown param is rejected on a single read too, not just a list', async (t) => {
  // Strictness must not differ by endpoint shape.
  const pg = fakeRefsPg(REFS);
  const app = build({ pg });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/api/v1/references/ref-1?colour=blue' });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error.message, /colour/);
});

test('a declared filter is still accepted after the strictness change', async (t) => {
  const pg = fakeRefsPg(REFS);
  const app = build({ pg });
  t.after(() => app.close());

  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/references?publication_type=journal%20article',
  });
  assert.equal(res.statusCode, 200);
  assert.ok(pg.calls.some((c) => /->>'/.test(c.text)), 'the declared filter reached SQL');
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
