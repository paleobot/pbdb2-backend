import { test } from 'node:test';
import assert from 'node:assert/strict';

import { build } from '../src/app.js';

/**
 * Multi-entity read via the `ids` list filter. Driven with NO database:
 * `build({ pg })` injects a fake postgres client whose handler answers the
 * `permid = ANY($1)` head query from a fixed table, so the route + repository +
 * filter seam all run in-process (mirrors repository.test.js).
 */
function fakePgFromTable(table) {
  const calls = [];
  return {
    calls,
    query: async (text, values) => {
      calls.push({ text, values });
      // The multi-get binds the requested set as $1; the single/list paths bind
      // a permid or nothing. Answer the multi-get from the table.
      if (text.includes('permid = ANY($1)')) {
        const requested = values[0];
        const rows = requested
          .filter((permid) => permid in table)
          .map((permid) => ({ permid, payload: table[permid] }));
        return { rows };
      }
      return { rows: [] };
    },
  };
}

const TABLE = {
  'ref-1': { title: 'On Trilobites', year: '1959' },
  'ref-2': { title: 'Graptolite Faunas', year: '1971' },
  'ref-3': { title: 'Cambrian Explosion', year: '1989' },
};

test('multi-get returns exactly the requested subset, missing empty', async (t) => {
  const pg = fakePgFromTable(TABLE);
  const app = build({ pg });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/api/v1/references?ids=ref-1,ref-2' });
  assert.equal(res.statusCode, 200);

  const body = res.json();
  assert.ok(Array.isArray(body.data));
  assert.deepEqual(
    body.data.map((d) => d.permid).sort(),
    ['ref-1', 'ref-2'],
  );
  assert.equal(body.meta.requested, 2);
  assert.equal(body.meta.found, 2);
  assert.deepEqual(body.meta.missing, []);

  // The requested set is bound as $1, under the head filter.
  const q = pg.calls.find((c) => c.text.includes('permid = ANY($1)'));
  assert.ok(q, 'a multi-head query ran');
  assert.match(q.text, /succeeded_by_id IS NULL/);
  assert.deepEqual(q.values, [['ref-1', 'ref-2']]);
});

test('multi-get partial success: unknown ids land in meta.missing, others returned', async (t) => {
  const pg = fakePgFromTable(TABLE);
  const app = build({ pg });
  t.after(() => app.close());

  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/references?ids=ref-1,ghost,ref-3',
  });
  assert.equal(res.statusCode, 200);

  const body = res.json();
  assert.deepEqual(
    body.data.map((d) => d.permid).sort(),
    ['ref-1', 'ref-3'],
  );
  assert.equal(body.meta.requested, 3);
  assert.equal(body.meta.found, 2);
  assert.deepEqual(body.meta.missing, ['ghost']);
});

test('single id still returns a list; duplicate ids collapse and requested is distinct', async (t) => {
  const pg = fakePgFromTable(TABLE);
  const app = build({ pg });
  t.after(() => app.close());

  const single = (await app.inject({ method: 'GET', url: '/api/v1/references?ids=ref-1' })).json();
  assert.ok(Array.isArray(single.data), 'single id is still an array');
  assert.equal(single.data.length, 1);
  assert.equal(single.meta.requested, 1);

  const dupes = (
    await app.inject({ method: 'GET', url: '/api/v1/references?ids=ref-1,ref-1,ref-1' })
  ).json();
  assert.equal(dupes.data.length, 1, 'duplicates collapse in data');
  assert.equal(dupes.meta.requested, 1, 'requested counts distinct ids');
  assert.deepEqual(dupes.meta.missing, []);
});

test('empty ?ids= is a 400; absent ids lists everything', async (t) => {
  const pg = fakePgFromTable(TABLE);
  const app = build({ pg });
  t.after(() => app.close());

  const empty = await app.inject({ method: 'GET', url: '/api/v1/references?ids=' });
  assert.equal(empty.statusCode, 400);
  assert.equal(empty.json().error.statusCode, 400);

  // Absent ids → the ordinary list path (no multi-head query), HTTP 200.
  const all = await app.inject({ method: 'GET', url: '/api/v1/references' });
  assert.equal(all.statusCode, 200);
  assert.ok(Array.isArray(all.json().data));
  assert.ok(!pg.calls.some((c) => c.text.includes('permid = ANY($1)')), 'no multi-head query for a bare list');
});

test('over-cap (>100 ids) is a 400; at-cap (100) is accepted', async (t) => {
  const pg = fakePgFromTable(TABLE);
  const app = build({ pg });
  t.after(() => app.close());

  const ids = (n) => Array.from({ length: n }, (_, i) => `ref-${i}`).join(',');

  const over = await app.inject({ method: 'GET', url: `/api/v1/references?ids=${ids(101)}` });
  assert.equal(over.statusCode, 400);

  const at = await app.inject({ method: 'GET', url: `/api/v1/references?ids=${ids(100)}` });
  assert.equal(at.statusCode, 200);
  assert.equal(at.json().meta.requested, 100);
});

test('stub fallback (no DB) echoes one stub per requested id, missing empty', async (t) => {
  const app = build(); // no pg → stub path
  t.after(() => app.close());

  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/specimens?ids=spc-1,spc-2,spc-3',
  });
  assert.equal(res.statusCode, 200);

  const body = res.json();
  assert.deepEqual(
    body.data.map((d) => d.permid),
    ['spc-1', 'spc-2', 'spc-3'],
  );
  assert.equal(body.meta.requested, 3);
  assert.deepEqual(body.meta.missing, []);
});
