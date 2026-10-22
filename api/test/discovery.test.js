import { test } from 'node:test';
import assert from 'node:assert/strict';

import { build, DEFAULT_PUBLIC_BASE_URL as BASE } from '../src/app.js';

test('base paths return index documents in the standard envelope', async (t) => {
  const app = build();
  t.after(() => app.close());

  for (const url of ['/', '/api', '/api/v1']) {
    const res = await app.inject({ method: 'GET', url });
    assert.equal(res.statusCode, 200, `${url} should return 200`);

    const body = res.json();
    assert.ok(body.data && typeof body.data === 'object');
    assert.equal(body.meta.type, 'index');
    assert.equal(body.links.self, `${BASE}${url}`);
  }
});

test('discovery links are derived from the route tree', async (t) => {
  const app = build();
  t.after(() => app.close());

  const root = (await app.inject({ method: 'GET', url: '/' })).json();
  assert.equal(root.links.api, `${BASE}/api`);

  const v1 = (await app.inject({ method: 'GET', url: '/api/v1' })).json();
  for (const resource of ['references', 'authorities', 'collections', 'schemas', 'taxa']) {
    assert.equal(v1.links[resource], `${BASE}/api/v1/${resource}`, `links should include ${resource}`);
  }
});

test('the version index links its description; specimens, a stub, is not listed', async (t) => {
  const app = build();
  t.after(() => app.close());

  const v1 = (await app.inject({ method: 'GET', url: '/api/v1' })).json();
  assert.deepEqual(Object.keys(v1.links).sort(), [
    'authorities', 'collections', 'describedby', 'docs', 'references', 'schemas', 'self', 'taxa',
  ]);
  assert.equal(v1.links.describedby, `${BASE}/api/v1/openapi.json`);
  assert.equal(v1.links.docs, `${BASE}/api/v1/docs`);

  for (const url of ['/', '/api']) {
    const { links } = (await app.inject({ method: 'GET', url })).json();
    assert.equal('describedby' in links || 'docs' in links, false, url);
  }
});

test('a hidden route is not listed, unless a visible one shares its segment', async (t) => {
  const app = build();
  const handler = async () => ({});
  app.register(async (f) => {
    f.get('/api/v1/secret', { schema: { hide: true } }, handler);
    f.get('/api/v1/mixed', handler);
    f.post('/api/v1/mixed', { schema: { hide: true } }, handler);
  });
  t.after(() => app.close());

  const { links } = (await app.inject({ method: 'GET', url: '/api/v1' })).json();
  assert.equal('secret' in links, false);
  assert.equal(links.mixed, `${BASE}/api/v1/mixed`);
});

test('an index takes no query parameters', async (t) => {
  const app = build();
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/api/v1?x=1' });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error.message, /`x`/);
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
