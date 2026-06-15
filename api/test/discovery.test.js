import { test } from 'node:test';
import assert from 'node:assert/strict';

import { build } from '../src/app.js';

test('base paths return index documents in the standard envelope', async (t) => {
  const app = build();
  t.after(() => app.close());

  for (const url of ['/', '/api', '/api/v1']) {
    const res = await app.inject({ method: 'GET', url });
    assert.equal(res.statusCode, 200, `${url} should return 200`);

    const body = res.json();
    assert.ok(body.data && typeof body.data === 'object');
    assert.equal(body.meta.type, 'index');
    assert.equal(body.links.self, url);
  }
});

test('discovery links are derived from the route tree', async (t) => {
  const app = build();
  t.after(() => app.close());

  const root = (await app.inject({ method: 'GET', url: '/' })).json();
  assert.equal(root.links.api, '/api');

  const v1 = (await app.inject({ method: 'GET', url: '/api/v1' })).json();
  for (const resource of ['references', 'authorities', 'collections', 'specimens', 'schemas']) {
    assert.equal(v1.links[resource], `/api/v1/${resource}`, `links should include ${resource}`);
  }
});

test('a resource with collection and :permid routes appears once in discovery', async (t) => {
  const app = build();
  t.after(() => app.close());

  const v1 = (await app.inject({ method: 'GET', url: '/api/v1' })).json();
  const referenceKeys = Object.keys(v1.links).filter((k) => k === 'references');
  assert.equal(referenceKeys.length, 1);
});

test('base paths tolerate a trailing slash', async (t) => {
  const app = build();
  t.after(() => app.close());

  for (const url of ['/api/', '/api/v1/']) {
    const res = await app.inject({ method: 'GET', url });
    assert.equal(res.statusCode, 200, `${url} should return 200`);
    assert.equal(res.json().meta.type, 'index');
  }
});

test('unknown paths still return a structured 404', async (t) => {
  const app = build();
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/api/v1/refrences' });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error.statusCode, 404);
});
