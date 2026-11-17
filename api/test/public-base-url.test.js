import { test } from 'node:test';
import assert from 'node:assert/strict';

import { build, DEFAULT_PUBLIC_BASE_URL } from '../src/app.js';
import { loadConfig, normalizePublicBaseUrl } from '../src/config.js';

test('the base is normalized: trailing slashes removed, a path kept', () => {
  assert.equal(normalizePublicBaseUrl('https://pbdb2.example.org/'), 'https://pbdb2.example.org');
  assert.equal(normalizePublicBaseUrl('https://pbdb2.example.org'), 'https://pbdb2.example.org');
  assert.equal(normalizePublicBaseUrl('https://pbdb2.example.org/base/'), 'https://pbdb2.example.org/base');
  assert.equal(normalizePublicBaseUrl('http://localhost:3000'), 'http://localhost:3000');
});

test('an invalid base is rejected', () => {
  for (const value of [
    '/api',
    'pbdb2.example.org',
    'ftp://pbdb2.example.org',
    'https://pbdb2.example.org?a=1',
    'https://pbdb2.example.org/?',
    'https://pbdb2.example.org#top',
    'https://user:secret@pbdb2.example.org',
  ]) {
    assert.throws(() => normalizePublicBaseUrl(value), /PUBLIC_BASE_URL/, value);
  }
});

test('build() throws on an invalid base', () => {
  assert.throws(() => build({ publicBaseUrl: '/api' }), /PUBLIC_BASE_URL/);
});

test('loadConfig defaults the base to localhost on the configured port', () => {
  assert.equal(loadConfig({}).publicBaseUrl, 'http://localhost:3000');
  assert.equal(loadConfig({ PORT: '4000' }).publicBaseUrl, 'http://localhost:4000');
  assert.equal(
    loadConfig({ PUBLIC_BASE_URL: 'https://pbdb2.example.org' }).publicBaseUrl,
    'https://pbdb2.example.org',
  );
});

test('build() ignores PUBLIC_BASE_URL in the environment when no option is passed', async () => {
  const saved = process.env.PUBLIC_BASE_URL;
  process.env.PUBLIC_BASE_URL = 'https://from-env.example.org';
  try {
    const app = build();
    await app.ready();
    assert.equal(app.publicBaseUrl, DEFAULT_PUBLIC_BASE_URL);
    const res = await app.inject({ method: 'GET', url: '/api/v1' });
    assert.equal(res.json().links.self, `${DEFAULT_PUBLIC_BASE_URL}/api/v1`);
    await app.close();
  } finally {
    if (saved === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = saved;
  }
});

// A base with a path, so a link that dropped the path or doubled a slash shows.
const OTHER = 'https://pbdb2.example.org/base';

test('every link on single, list and index responses starts with the configured base', async (t) => {
  const app = build({ publicBaseUrl: `${OTHER}/` }); // no pg → stub reads
  t.after(() => app.close());

  const single = (await app.inject({ method: 'GET', url: '/api/v1/authorities/aut-x' })).json();
  assert.equal(single.links.self, `${OTHER}/api/v1/authorities/aut-x`);
  assert.equal(single.data.reference.href, `${OTHER}/api/v1/references/ref-00000000`);

  const list = (await app.inject({ method: 'GET', url: '/api/v1/collections?limit=2' })).json();
  assert.equal(list.links.self, `${OTHER}/api/v1/collections?limit=2`);
  assert.equal(list.data[0].primaryReference.href, `${OTHER}/api/v1/references/ref-00000000`);

  const root = (await app.inject({ method: 'GET', url: '/' })).json();
  assert.equal(root.links.self, `${OTHER}/`);
  assert.equal(root.data.resources.api.href, `${OTHER}/api`);

  const v1 = (await app.inject({ method: 'GET', url: '/api/v1' })).json();
  for (const [name, href] of Object.entries(v1.links)) {
    assert.ok(href.startsWith(`${OTHER}/api/v1`), `${name}: ${href}`);
  }
  for (const [name, { href }] of Object.entries(v1.data.resources)) {
    assert.ok(href.startsWith(`${OTHER}/api/v1/`), `${name}: ${href}`);
  }
});

test('request headers do not change the base', async (t) => {
  const app = build({ publicBaseUrl: OTHER });
  t.after(() => app.close());

  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/authorities/aut-x',
    headers: {
      host: 'evil.example.com',
      'x-forwarded-host': 'evil.example.com',
      'x-forwarded-proto': 'http',
    },
  });
  const body = res.json();
  assert.equal(body.links.self, `${OTHER}/api/v1/authorities/aut-x`);
  assert.equal(body.data.reference.href, `${OTHER}/api/v1/references/ref-00000000`);
});
