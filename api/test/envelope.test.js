import { test } from 'node:test';
import assert from 'node:assert/strict';

import { build } from '../src/app.js';

test('single read returns the { data, meta, links } envelope', async (t) => {
  const app = build();
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/api/v1/references/ref-123' });
  assert.equal(res.statusCode, 200);

  const body = res.json();
  assert.ok(body.data && typeof body.data === 'object' && !Array.isArray(body.data));
  assert.equal(body.data.permid, 'ref-123');
  assert.equal('id' in body.data, false, 'internal id must not be exposed');

  // meta + reserved version slot
  assert.equal(body.meta.type, 'reference');
  assert.deepEqual(body.meta.version, { supersedes: null, supersededBy: null });

  // links + self
  assert.equal(body.links.self, '/api/v1/references/ref-123');
});

test('list read returns an array with counts and reserved pagination slots', async (t) => {
  const app = build();
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/api/v1/references' });
  assert.equal(res.statusCode, 200);

  const body = res.json();
  assert.ok(Array.isArray(body.data));
  assert.equal(typeof body.meta.found, 'number');
  assert.equal(typeof body.meta.returned, 'number');
  assert.equal('next' in body.links, true);
  assert.equal('prev' in body.links, true);
});

test('schemas single read returns the aggregate tree', async (t) => {
  const app = build();
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/api/v1/schemas/sch-1' });
  assert.equal(res.statusCode, 200);

  const body = res.json();
  assert.ok(Array.isArray(body.data.characters), 'schema carries nested characters');
  assert.ok(Array.isArray(body.data.characters[0].states), 'characters carry nested states');
});
