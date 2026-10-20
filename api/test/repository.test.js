import { test } from 'node:test';
import assert from 'node:assert/strict';

import { build, DEFAULT_PUBLIC_BASE_URL as BASE } from '../src/app.js';
import { makeReadRepository } from '../src/lib/repository.js';
import { descriptorFor } from '../src/lib/resource-tables.js';
import { referenceSource } from '../../payloadSchemas/reference.schema.js';

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
      { permid: 'ref-1', payload: { title: 'Alpha' } },
      { permid: 'ref-2', payload: { title: 'Beta' } },
    ],
  }));
  const app = build({ pg });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/api/v1/references' });
  assert.equal(res.statusCode, 200);

  const body = res.json();
  assert.ok(Array.isArray(body.data));
  assert.equal(body.data.length, 2);
  assert.equal(body.meta.found, 2);
  assert.deepEqual(
    body.data.map((d) => d.permid),
    ['ref-1', 'ref-2'],
  );
});

test('reads expose only permid + payload — no internal ids or chain columns leak', async (t) => {
  const pg = fakePg(() => ({
    rows: [{ permid: 'ref-1', payload: { title: 'On Trilobites', year: '1959' } }],
  }));
  const app = build({ pg });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/api/v1/references/ref-1' });
  const { data } = res.json();
  assert.deepEqual(Object.keys(data).sort(), ['permid', 'title', 'year']);
  for (const forbidden of ['id', 'preceded_by_id', 'succeeded_by_id', 'removed']) {
    assert.ok(!(forbidden in data), `${forbidden} must not be exposed`);
  }
});

// A schema head as the source path selects it (id and reference_id are bigints,
// so strings), one child row repeating its primary, and the tree query's row:
// a character holding a quantitative state and a qualitative one.
const SCHEMA_HEAD = { id: '4', permid: 'sch-1', payload: { title: 'Leaf architecture', year: '2023' }, reference_id: '7' };
const SCHEMA_TREE_ROW = {
  characters: [
    { id: 1, permid: 'chr-1', payload: { name: 'Margin' }, sortOrder: 1, parentCharacterId: null },
  ],
  states: [
    { id: 11, permid: 'stt-2', payload: { name: 'Length' }, quantitative: true, sortOrder: 2, parentCharacterId: 1, parentStateId: null },
    { id: 10, permid: 'stt-1', payload: { name: 'Entire' }, quantitative: false, sortOrder: 1, parentCharacterId: 1, parentStateId: null },
  ],
};

function schemasPg() {
  return fakePg((text, values) => {
    if (text.includes('WITH RECURSIVE')) return { rows: values[0] === 'sch-1' ? [SCHEMA_TREE_ROW] : [] };
    if (text.includes('FROM "additional_schema_refs"')) return { rows: [{ parent: '4', id: '1', reference_id: '7' }] };
    if (text.includes('FROM "refs"')) return { rows: [{ k: '7', v: 'ref-7', l0: 'Primary', removed: false }] };
    return { rows: [SCHEMA_HEAD].filter((r) => r.permid === values[0]) };
  });
}

test('schemas single read: the repository head, then the tree, each node merged', async (t) => {
  const pg = schemasPg();
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
  assert.deepEqual(char.states.map((s) => [s.permid, s.quantitative]), [['stt-1', false], ['stt-2', true]]);

  // Heads, their child rows, the refs they cite, then the tree: no link columns.
  const [head, children, refs, tree] = pg.calls;
  assert.match(head.text, /^SELECT permid, "schema" AS payload, id, "reference_id" FROM "schemas" WHERE permid = \$1/);
  assert.match(children.text, /FROM "additional_schema_refs" WHERE "schema_id" = ANY\(\$1\)/);
  assert.match(refs.text, /FROM "refs"/);
  assert.match(tree.text, /WITH RECURSIVE/);
  assert.equal(pg.calls.length, 4);
  for (const leaked of ['reference_id', 'json_build_object(\'title\'', 'additional_schema_refs']) {
    assert.equal(tree.text.includes(leaked), false, `the tree query selects no ${leaked}`);
  }

  // No node carries a storage internal.
  const internals = ['id', 'reference_id', 'parent_schema_id', 'parent_character_id', 'parent_state_id', 'sort_order',
    'sortOrder', 'parentCharacterId', 'parentStateId'];
  for (const node of [data, char, ...char.states]) {
    for (const forbidden of internals) assert.ok(!(forbidden in node), `${forbidden} must not be exposed`);
  }
  assert.equal('quantitative' in char, false, 'a character has no quantitative');
});

test('schemas single read with no head returns a structured 404', async (t) => {
  const pg = fakePg(() => ({ rows: [] }));
  const app = build({ pg });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/api/v1/schemas/missing' });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error.statusCode, 404);
  assert.equal(pg.calls.length, 1, 'the head read answers it; no tree query runs');
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

test('a repository without a payload source is refused, naming its table', () => {
  const pg = fakePg(() => {
    throw new Error('no query may run');
  });
  assert.throws(
    () => makeReadRepository({ pg, table: 'collections', jsonbColumn: 'collection' }),
    /Resource table 'collections' has no payload source/,
  );
  assert.equal(pg.calls.length, 0);
});

test('enriched single read carries href hydrated from the route prefix', async (t) => {
  // Collections' links are covered in test/source-reads.test.js.
  const app = build({ pg: schemasPg() });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/api/v1/schemas/sch-1' });
  const { data } = res.json();
  assert.deepEqual(data.primaryReference, { permid: 'ref-7', title: 'Primary', href: `${BASE}/api/v1/references/ref-7` });
  assert.deepEqual(data.additionalReferences, [{ permid: 'ref-7', title: 'Primary', href: `${BASE}/api/v1/references/ref-7` }]);
});

test('stub reads expose the enriched reference shape with href (no DB configured)', async (t) => {
  const app = build(); // no pg → stub path
  t.after(() => app.close());

  const authority = (await app.inject({ method: 'GET', url: '/api/v1/authorities/aut-x' })).json().data;
  assert.equal(authority.reference.title, 'Stub reference');
  assert.equal(authority.reference.href, `${BASE}/api/v1/references/ref-00000000`);

  const collection = (await app.inject({ method: 'GET', url: '/api/v1/collections/col-x' })).json().data;
  assert.equal(collection.primaryReference.href, `${BASE}/api/v1/references/ref-00000000`);
  assert.deepEqual(collection.additionalReferences, []);

  const schema = (await app.inject({ method: 'GET', url: '/api/v1/schemas/sch-x' })).json().data;
  assert.deepEqual(schema.primaryReference, {
    permid: 'ref-00000000', title: 'Stub reference', href: `${BASE}/api/v1/references/ref-00000000`,
  });
  assert.deepEqual(schema.additionalReferences, []);
  assert.equal(schema.characters[0].states[0].quantitative, false);
});

test('a filter on a source enum carries that enum as its legal values', () => {
  const repo = makeReadRepository({ pg: fakePg(() => ({ rows: [] })), ...descriptorFor('references') });
  assert.deepEqual(repo.filters.publication_type, {
    jsonPath: 'publicationType',
    op: 'eq',
    values: referenceSource.properties.publicationType.enum,
  });
});

test('a filter on a field with no enum is exposed as declared', () => {
  const pg = fakePg(() => ({ rows: [] }));
  const onTitle = { title: { jsonPath: 'title', op: 'eq' } };
  const repo = makeReadRepository({ pg, table: 'refs', jsonbColumn: 'reference', filters: onTitle, source: referenceSource });
  assert.deepEqual(repo.filters, onTitle);
});
