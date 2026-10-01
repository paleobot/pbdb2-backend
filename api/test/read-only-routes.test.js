import { test } from 'node:test';
import assert from 'node:assert/strict';

import { build } from '../src/app.js';

/**
 * The read-only resource shape. `taxa` is the first group to use it: it is
 * materialized output of the backend's derivation, so its write verbs are
 * refused rather than stubbed like every other group's.
 *
 * The distinction these pin is 405-not-404 (the resource exists; the method does
 * not apply) and 405-not-401 (there is no write to authorize, so a refused
 * method must never look like an authentication failure).
 */

const WRITE_VERBS = ['POST', 'PUT', 'PATCH', 'DELETE'];
const TAXA_PATHS = ['/api/v1/taxa', '/api/v1/taxa/some-permid'];

function fakePg() {
  return { query: async () => ({ rows: [] }) };
}

test('every write verb on a read-only group is 405 on both paths', async (t) => {
  const app = build({ pg: fakePg() });
  t.after(() => app.close());

  for (const method of WRITE_VERBS) {
    for (const url of TAXA_PATHS) {
      const res = await app.inject({ method, url });
      assert.equal(res.statusCode, 405, `${method} ${url}`);
      assert.equal(res.json().error.statusCode, 405, `${method} ${url} uses the error shape`);
    }
  }
});

test('a 405 carries an Allow header naming the permitted methods', async (t) => {
  const app = build({ pg: fakePg() });
  t.after(() => app.close());

  for (const method of WRITE_VERBS) {
    const res = await app.inject({ method, url: '/api/v1/taxa' });
    // RFC 9110 requires Allow on a 405; it is also what makes the refusal
    // discoverable rather than merely a refusal.
    assert.match(res.headers.allow, /GET/, `${method} advertises GET`);
  }
});

test('a refused write verb is not an authentication failure', async (t) => {
  const app = build({ pg: fakePg() });
  t.after(() => app.close());

  // No credentials are sent. A read-only group attaches no authenticate
  // preHandler, so the method is refused regardless of identity.
  const res = await app.inject({ method: 'POST', url: '/api/v1/taxa' });
  assert.equal(res.statusCode, 405);
  assert.notEqual(res.statusCode, 401);
  assert.match(res.json().error.message, /read-only/);
});

test('the 405 message names the resource type and the verb', async (t) => {
  const app = build({ pg: fakePg() });
  t.after(() => app.close());

  const res = await app.inject({ method: 'DELETE', url: '/api/v1/taxa/x' });
  const { message } = res.json().error;
  assert.match(message, /taxon/);
  assert.match(message, /DELETE/);
});

test('read verbs on a read-only group are unaffected', async (t) => {
  const app = build({ pg: fakePg() });
  t.after(() => app.close());

  const list = await app.inject({ method: 'GET', url: '/api/v1/taxa' });
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().meta.type, 'taxon');
});

test('the five CRUD groups keep their write verbs', async (t) => {
  const app = build();
  t.after(() => app.close());

  // Introducing the read-only option must not have narrowed anything else.
  for (const group of ['references', 'authorities', 'collections', 'specimens', 'schemas']) {
    const res = await app.inject({ method: 'POST', url: `/api/v1/${group}` });
    assert.equal(res.statusCode, 201, `${group} still creates`);

    const del = await app.inject({ method: 'DELETE', url: `/api/v1/${group}/x` });
    assert.equal(del.statusCode, 204, `${group} still deletes`);
  }
});
