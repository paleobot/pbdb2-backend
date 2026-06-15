import { test } from 'node:test';
import assert from 'node:assert/strict';

import { build } from '../src/app.js';

test('GET does not invoke the authenticate seam', async (t) => {
  const app = build();
  t.after(() => app.close());
  await app.ready();

  const res = await app.inject({ method: 'GET', url: '/api/v1/references' });
  assert.equal(res.statusCode, 200);
  assert.equal(app.authStub.invocations, 0);
});

test('write verbs invoke the authenticate seam', async (t) => {
  const app = build();
  t.after(() => app.close());
  await app.ready();

  await app.inject({ method: 'POST', url: '/api/v1/references', payload: {} });
  assert.equal(app.authStub.invocations, 1);

  await app.inject({ method: 'DELETE', url: '/api/v1/references/ref-1' });
  assert.equal(app.authStub.invocations, 2);
});
