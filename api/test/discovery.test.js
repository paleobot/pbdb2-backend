import { test } from 'node:test';
import assert from 'node:assert/strict';

import { build, DEFAULT_PUBLIC_BASE_URL as BASE } from '../src/app.js';
import { assertEnvelope } from './published.js';

/** An index's children, as `{ name: href }`. */
const hrefs = (resources) => Object.fromEntries(Object.entries(resources).map(([name, { href }]) => [name, href]));

test('base paths return index documents in the standard envelope', async (t) => {
  const app = build();
  t.after(() => app.close());

  for (const url of ['/', '/api', '/api/v1']) {
    const res = await app.inject({ method: 'GET', url });
    assert.equal(res.statusCode, 200, `${url} should return 200`);

    const body = res.json();
    assertEnvelope('index', null, body);
    assert.equal(body.meta.type, 'index');
    assert.equal(body.links.self, `${BASE}${url}`);
  }
});

test('each index lists its children in data.resources, derived from the route tree', async (t) => {
  const app = build();
  t.after(() => app.close());

  const root = (await app.inject({ method: 'GET', url: '/' })).json();
  assert.deepEqual(hrefs(root.data.resources), { api: `${BASE}/api` });
  const api = (await app.inject({ method: 'GET', url: '/api' })).json();
  assert.deepEqual(hrefs(api.data.resources), { v1: `${BASE}/api/v1` });

  // specimens, a stub, is hidden; so are the description's own routes.
  const v1 = (await app.inject({ method: 'GET', url: '/api/v1' })).json();
  assert.deepEqual(hrefs(v1.data.resources), Object.fromEntries(
    ['authorities', 'collections', 'references', 'schemas', 'taxa'].map((r) => [r, `${BASE}/api/v1/${r}`]),
  ));
  assert.equal(v1.data.name, 'PBDB2 API', 'the node is still described beside its children');
});

test('links hold only relations; the version index links its description', async (t) => {
  const app = build();
  t.after(() => app.close());

  const v1 = (await app.inject({ method: 'GET', url: '/api/v1' })).json();
  assert.deepEqual(v1.links, {
    self: `${BASE}/api/v1`,
    'service-desc': `${BASE}/api/v1/openapi.json`,
    'service-doc': `${BASE}/api/v1/docs`,
  });

  for (const url of ['/', '/api']) {
    const { links } = (await app.inject({ method: 'GET', url })).json();
    assert.deepEqual(links, { self: `${BASE}${url}` }, url);
  }
});

test('the published index schema refuses a child name in links', async (t) => {
  const app = build();
  t.after(() => app.close());

  const v1 = (await app.inject({ method: 'GET', url: '/api/v1' })).json();
  assert.throws(() => assertEnvelope('index', null, { ...v1, links: { ...v1.links, taxa: `${BASE}/api/v1/taxa` } }));
  assert.throws(() => assertEnvelope('index', null, { ...v1, data: { ...v1.data, resources: { taxa: `${BASE}/api/v1/taxa` } } }));
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

  const { data } = (await app.inject({ method: 'GET', url: '/api/v1' })).json();
  assert.equal('secret' in data.resources, false);
  assert.deepEqual(data.resources.mixed, { href: `${BASE}/api/v1/mixed` });
});

test('an index takes no query parameters', async (t) => {
  const app = build();
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/api/v1?x=1' });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error.message, /`x`/);
});

test('a resource with collection and :permid routes is one child, not two', async (t) => {
  const app = build();
  t.after(() => app.close());

  const { data } = (await app.inject({ method: 'GET', url: '/api/v1' })).json();
  assert.equal(Object.keys(data.resources).some((name) => name.startsWith(':') || name.includes('/')), false);
  assert.deepEqual(data.resources.references, { href: `${BASE}/api/v1/references` });
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
