import { test } from 'node:test';
import assert from 'node:assert/strict';

import { build } from '../src/app.js';

test('a path without the /api/v1 prefix returns 404 with a structured error', async (t) => {
  const app = build();
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/references' });
  assert.equal(res.statusCode, 404);

  const body = res.json();
  assert.ok(body.error, 'error body is structured');
  assert.equal(body.error.statusCode, 404);
});

test('routes are reachable under the /api/v1 prefix', async (t) => {
  const app = build();
  t.after(() => app.close());

  for (const resource of ['references', 'authorities', 'collections', 'specimens', 'schemas']) {
    const res = await app.inject({ method: 'GET', url: `/api/v1/${resource}` });
    assert.equal(res.statusCode, 200, `${resource} list should be reachable`);
  }
});
