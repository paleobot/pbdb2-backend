import { test } from 'node:test';
import assert from 'node:assert/strict';

import { build } from '../src/app.js';
import { DEFAULT_LIMIT } from '../src/lib/list-filters.js';
import { allowedOn } from '../src/lib/resource-tables.js';

/**
 * Per-entity field filters on `references` (publicationType). The fake pg
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
  'ref-1': { title: 'A', publicationType: 'standalone book' },
  'ref-2': { title: 'B', publicationType: 'journal article' },
  'ref-3': { title: 'C', publicationType: 'standalone book' },
};

test('references filtered by publicationType returns only matching heads', async (t) => {
  const pg = fakeRefsPg(REFS);
  const app = build({ pg });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/api/v1/references?publicationType=standalone%20book' });
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
  assert.deepEqual(q.values, ['standalone book', DEFAULT_LIMIT + 1]);
});

test('field filter composes with ids in a single WHERE', async (t) => {
  const pg = fakeRefsPg(REFS);
  const app = build({ pg });
  t.after(() => app.close());

  // ref-1 (standalone book, in ids) matches; ref-2 (journal, in ids) filtered
  // out; ref-3 (standalone book, not in ids) excluded.
  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/references?ids=ref-1,ref-2&publicationType=standalone%20book',
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
  assert.deepEqual(q.values, [['ref-1', 'ref-2'], 'standalone book', DEFAULT_LIMIT + 1]);
});

test('the shared-field filters reach SQL as bound predicates and compose with ids and each other', async (t) => {
  const pg = fakeRefsPg(REFS);
  const app = build({ pg });
  t.after(() => app.close());

  const res = await app.inject({
    method: 'GET',
    url:
      '/api/v1/references?ids=ref-1,ref-2&publicationType=standalone%20book&doi=DOI:10.1/X' +
      '&title=on%20trilobites&authors=Sues,Reisz&firstAuthor=Sues&publicationYear=1990-2000',
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().meta.missing, undefined, 'a filtered ids read has no missing accounting');

  const q = pg.calls.find((c) => c.text.includes('permid = ANY($1)'));
  assert.ok(q, 'one composed query ran');
  for (const fragment of [
    `->>'publicationType' = $2`,
    `regexp_replace("reference"->>'doi', $3, '', 'i')) = $4`,
    `unaccent("reference"->>'title') ILIKE ('%' || unaccent($5) || '%') AND`,
    `ILIKE ('%' || unaccent($6) || '%')`,
    `jsonb_array_elements("reference"->'authors') a WHERE lower(unaccent(a->>'familyName')) = lower(unaccent($7))`,
    `= lower(unaccent($8)))`,
    `lower(unaccent("reference"->'authors'->0->>'familyName')) = lower(unaccent($9))`,
    `BETWEEN $10 AND $11`,
  ]) {
    assert.ok(q.text.includes(fragment), fragment);
  }
  assert.deepEqual(q.values.slice(0, 2), [['ref-1', 'ref-2'], 'standalone book']);
  assert.deepEqual(q.values.slice(3, -1), ['10.1/x', 'on', 'trilobites', 'Sues', 'Reisz', 'Sues', 1990, 2000]);
});

test('allowedOn names the types whose fields list the field, then other', () => {
  assert.equal(allowedOn('journalTitle'), 'Allowed on journal article and other.');
  assert.equal(
    allowedOn('publisher'),
    'Allowed on standalone book, edited collection, article in edited collection, serial monograph and other.',
  );
  assert.equal(allowedOn('bookType'), 'Allowed on standalone book and other.');
});

test('the type-specific filters reach SQL as bound predicates and compose with publicationType and ids', async (t) => {
  const pg = fakeRefsPg(REFS);
  const app = build({ pg });
  t.after(() => app.close());

  const res = await app.inject({
    method: 'GET',
    url:
      '/api/v1/references?ids=ref-1,ref-2&publicationType=standalone%20book&journalTitle=Palaeontology' +
      '&seriesTitle=Novitates&bookTitle=Dinosauria&publisher=Elsevier&publicationCity=Washington&bookType=monograph',
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().meta.missing, undefined, 'a filtered ids read has no missing accounting');

  const q = pg.calls.find((c) => c.text.includes('permid = ANY($1)'));
  assert.ok(q, 'one composed query ran');
  for (const fragment of [
    `->>'publicationType' = $2`,
    `lower(unaccent(regexp_replace("reference"->>'journalTitle', '\\s+', ' ', 'g'))) = lower(unaccent(regexp_replace($3,`,
    `lower(unaccent(regexp_replace("reference"->>'seriesTitle', '\\s+', ' ', 'g'))) = lower(unaccent(regexp_replace($4,`,
    `unaccent("reference"->>'bookTitle') ILIKE ('%' || unaccent($5) || '%')`,
    `unaccent("reference"->>'publisher') ILIKE ('%' || unaccent($6) || '%')`,
    `unaccent("reference"->>'publicationCity') ILIKE ('%' || unaccent($7) || '%')`,
    `"reference"->>'bookType' = $8`,
  ]) {
    assert.ok(q.text.includes(fragment), fragment);
  }
  assert.deepEqual(q.values.slice(0, -1), [
    ['ref-1', 'ref-2'], 'standalone book', 'Palaeontology', 'Novitates', 'Dinosauria', 'Elsevier', 'Washington', 'monograph',
  ]);
});

test('a legal field-filter value with no match is an empty 200 with no missing accounting', async (t) => {
  const pg = fakeRefsPg(REFS);
  const app = build({ pg });
  t.after(() => app.close());

  // `unpublished` is a publication type, but no fixture has it.
  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/references?publicationType=unpublished',
  });
  assert.equal(res.statusCode, 200);

  const body = res.json();
  assert.deepEqual(body.data, []);
  assert.equal(body.meta.returned, 0);
  assert.equal(body.meta.missing, undefined, 'field filters produce no missing accounting');
});

test('a field-filter value outside the source enum is a 400 listing the legal values', async (t) => {
  const pg = fakeRefsPg(REFS);
  const app = build({ pg });
  t.after(() => app.close());

  // `book` is not a publication type (`standalone book` is), so it could match
  // no stored reference: an empty 200 would read as "no books".
  const res = await app.inject({ method: 'GET', url: '/api/v1/references?publicationType=book' });
  assert.equal(res.statusCode, 400);
  const { error } = res.json();
  assert.equal(error.statusCode, 400);
  assert.match(error.message, /`publicationType` must be one of: /);
  assert.match(error.message, /standalone book/);
  assert.equal(pg.calls.length, 0, 'rejected before any query');
});

test('the enum check applies to an ids read too', async (t) => {
  const pg = fakeRefsPg(REFS);
  const app = build({ pg });
  t.after(() => app.close());

  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/references?ids=ref-1,ref-2&publicationType=book',
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error.message, /`publicationType` must be one of: /);
});

test('empty publicationType value is a 400', async (t) => {
  const pg = fakeRefsPg(REFS);
  const app = build({ pg });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/api/v1/references?publicationType=' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.statusCode, 400);
});

test('the former snake_case filter name is an unrecognized param', async (t) => {
  // A filter is named like the field it matches. A stale client sending the
  // old name gets a 400 pointing at the new one, never an unfiltered list.
  const pg = fakeRefsPg(REFS);
  const app = build({ pg });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/api/v1/references?publication_type=standalone%20book' });
  assert.equal(res.statusCode, 400);
  const { message } = res.json().error;
  assert.match(message, /Unrecognized query parameter: `publication_type`/);
  assert.match(message, /accepts .*`publicationType`/);
  assert.equal(pg.calls.length, 0, 'rejected before any query');
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
    url: '/api/v1/references?publicationType=journal%20article',
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
