import { test } from 'node:test';
import assert from 'node:assert/strict';

import { build } from '../src/app.js';
import { makeReadRepository } from '../src/lib/repository.js';

/**
 * DB-backed reads, driven with NO database: `build({ pg })` injects a fake
 * postgres client so the repository/route logic runs in-process. This keeps the
 * default `npm test` database-free while still exercising the real read path
 * (the integration tier verifies behavior against actual PostgreSQL + triggers).
 */
function fakePg(handler) {
  const calls = [];
  return {
    calls,
    query: async (text, values) => {
      calls.push({ text, values });
      return handler(text, values);
    },
  };
}

test('DB-backed single read returns the head record in the envelope', async (t) => {
  const pg = fakePg(() => ({
    rows: [{ permid: 'ref-1', payload: { title: 'On Trilobites', year: '1959' } }],
  }));
  const app = build({ pg });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/api/v1/references/ref-1' });
  assert.equal(res.statusCode, 200);

  const body = res.json();
  assert.equal(body.data.permid, 'ref-1');
  assert.equal(body.data.title, 'On Trilobites');
  // The query filters to the current, non-removed head, bound by permid.
  const single = pg.calls.find((c) => c.text.includes('WHERE permid = $1'));
  assert.ok(single, 'a permid-bound head query ran');
  assert.match(single.text, /succeeded_by_id IS NULL/);
  assert.match(single.text, /NOT COALESCE\(removed, false\)/);
  assert.deepEqual(single.values, ['ref-1']);
});

test('DB-backed single read with no head returns a structured 404', async (t) => {
  const pg = fakePg(() => ({ rows: [] }));
  const app = build({ pg });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/api/v1/references/does-not-exist' });
  assert.equal(res.statusCode, 404);

  const body = res.json();
  assert.ok(body.error, 'error body is structured');
  assert.equal(body.error.statusCode, 404);
  assert.match(body.error.message, /does-not-exist/);
});

test('DB-backed list returns the mapped heads with counts', async (t) => {
  const pg = fakePg(() => ({
    rows: [
      { permid: 'col-1', payload: { name: 'Alpha' } },
      { permid: 'col-2', payload: { name: 'Beta' } },
    ],
  }));
  const app = build({ pg });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/api/v1/collections' });
  assert.equal(res.statusCode, 200);

  const body = res.json();
  assert.ok(Array.isArray(body.data));
  assert.equal(body.data.length, 2);
  assert.equal(body.meta.found, 2);
  assert.deepEqual(
    body.data.map((d) => d.permid),
    ['col-1', 'col-2'],
  );
});

test('reads expose only permid + payload — no internal ids or chain columns leak', async (t) => {
  const pg = fakePg(() => ({
    rows: [{ permid: 'aut-1', payload: { taxonName: 'Calymene', rank: 'genus' } }],
  }));
  const app = build({ pg });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/api/v1/authorities/aut-1' });
  const { data } = res.json();
  assert.deepEqual(Object.keys(data).sort(), ['permid', 'rank', 'taxonName']);
  for (const forbidden of ['id', 'preceded_by_id', 'succeeded_by_id', 'removed']) {
    assert.ok(!(forbidden in data), `${forbidden} must not be exposed`);
  }
});

test('schemas single read assembles the tree and strips internal linkage', async (t) => {
  const pg = fakePg(() => ({
    rows: [
      {
        permid: 'sch-1',
        payload: { title: 'Leaf architecture' },
        characters: [
          { id: 1, permid: 'chr-1', payload: { name: 'Margin' }, sortOrder: 1, parentCharacterId: null },
        ],
        states: [
          {
            id: 10,
            permid: 'stt-1',
            payload: { name: 'Entire' },
            sortOrder: 1,
            parentCharacterId: 1,
            parentStateId: null,
          },
        ],
      },
    ],
  }));
  const app = build({ pg });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/api/v1/schemas/sch-1' });
  assert.equal(res.statusCode, 200);

  const { data } = res.json();
  assert.equal(data.permid, 'sch-1');
  assert.equal(data.title, 'Leaf architecture');
  assert.equal(data.characters.length, 1);

  const char = data.characters[0];
  assert.equal(char.permid, 'chr-1');
  assert.equal(char.name, 'Margin');
  assert.equal(char.states[0].permid, 'stt-1');
  assert.equal(char.states[0].name, 'Entire');

  // Internal linkage/sort fields are stripped from the output tree.
  for (const node of [char, char.states[0]]) {
    for (const forbidden of ['id', '_sortOrder', '_parentCharacterId', '_parentStateId', 'sortOrder']) {
      assert.ok(!(forbidden in node), `${forbidden} must not be exposed`);
    }
  }
});

test('schemas single read with no head returns a structured 404', async (t) => {
  const pg = fakePg(() => ({ rows: [] }));
  const app = build({ pg });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/api/v1/schemas/missing' });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error.statusCode, 404);
});

test('specimens read stays stubbed and never touches the database', async (t) => {
  const pg = fakePg(() => {
    throw new Error('specimens must not query the database');
  });
  const app = build({ pg });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/api/v1/specimens/spc-1' });
  assert.equal(res.statusCode, 200);
  assert.equal(pg.calls.length, 0, 'no query should have run for specimens');
});

const collectionRefs = {
  primary: { as: 'primaryReference', via: 'reference_id' },
  additional: {
    as: 'additionalReferences',
    joinTable: 'additional_collection_refs',
    joinKey: 'collection_id',
  },
};

test('repository builds reference projections and merges them by their `as` key', async () => {
  const pg = fakePg(() => ({
    rows: [
      {
        permid: 'col-1',
        payload: { name: 'Alpha' },
        primaryReference: { title: 'Primary', permid: 'ref-9' },
        additionalReferences: [{ title: 'Add', permid: 'ref-10' }],
      },
    ],
  }));
  const repo = makeReadRepository({
    pg,
    table: 'collections',
    jsonbColumn: 'collection',
    references: collectionRefs,
  });

  const rec = await repo.readHead('col-1');
  assert.equal(rec.name, 'Alpha');
  assert.deepEqual(rec.primaryReference, { title: 'Primary', permid: 'ref-9' });
  assert.deepEqual(rec.additionalReferences, [{ title: 'Add', permid: 'ref-10' }]);

  // The projection SQL: a primary scalar sub-select + an additional json_agg,
  // both suppressing removed refs, over the join table.
  const q = pg.calls[0].text;
  assert.match(q, /json_build_object\('title', r\.reference->>'title', 'permid', r\.permid\)/);
  assert.match(q, /FROM refs r WHERE r\.id = "collections"\."reference_id"/);
  assert.match(q, /json_agg/);
  assert.match(q, /"additional_collection_refs" j JOIN refs r/);
  assert.match(q, /j\."collection_id" = "collections"\.id/);
  assert.match(q, /NOT COALESCE\(r\.removed, false\)/);
});

test('repository without a references config emits no projections and merges nothing extra', async () => {
  const pg = fakePg(() => ({ rows: [{ permid: 'ref-1', payload: { title: 'T' } }] }));
  const repo = makeReadRepository({ pg, table: 'refs', jsonbColumn: 'reference' });

  const rec = await repo.readHead('ref-1');
  assert.deepEqual(Object.keys(rec).sort(), ['permid', 'title']);
  assert.doesNotMatch(pg.calls[0].text, /json_build_object/);
});

test('enriched single read carries href hydrated from the route prefix', async (t) => {
  const pg = fakePg(() => ({
    rows: [
      {
        permid: 'col-1',
        payload: { name: 'Alpha' },
        primaryReference: { title: 'Primary', permid: 'ref-9' },
        additionalReferences: [{ title: 'Add', permid: 'ref-10' }],
      },
    ],
  }));
  const app = build({ pg });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/api/v1/collections/col-1' });
  const { data } = res.json();
  assert.equal(data.primaryReference.href, '/api/v1/references/ref-9');
  assert.equal(data.additionalReferences[0].href, '/api/v1/references/ref-10');
});

test('stub reads expose the enriched reference shape with href (no DB configured)', async (t) => {
  const app = build(); // no pg → stub path
  t.after(() => app.close());

  const authority = (await app.inject({ method: 'GET', url: '/api/v1/authorities/aut-x' })).json().data;
  assert.equal(authority.reference.title, 'Stub reference');
  assert.equal(authority.reference.href, '/api/v1/references/ref-00000000');

  const collection = (await app.inject({ method: 'GET', url: '/api/v1/collections/col-x' })).json().data;
  assert.equal(collection.primaryReference.href, '/api/v1/references/ref-00000000');
  assert.deepEqual(collection.additionalReferences, []);

  const schema = (await app.inject({ method: 'GET', url: '/api/v1/schemas/sch-x' })).json().data;
  assert.equal(schema.primaryReference.href, '/api/v1/references/ref-00000000');
  assert.deepEqual(schema.additionalReferences, []);
});
