import { test } from 'node:test';
import assert from 'node:assert/strict';

import { build } from '../src/app.js';
import { negotiate, JSON_TYPE } from '../src/lib/formats.js';

/**
 * Content negotiation (csv-output): `negotiate` picks the format, and the
 * onRequest hook sets `Vary` and answers 406 for a format a route does not offer.
 */

const CSV = 'text/csv';
const pick = (accept) => negotiate(accept, [CSV]);

test('JSON is the default', () => {
  assert.equal(pick(undefined), JSON_TYPE, 'no Accept header');
  assert.equal(pick(''), JSON_TYPE);
  assert.equal(pick('*/*'), JSON_TYPE);
  assert.equal(pick('application/json'), JSON_TYPE);
  assert.equal(pick('text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'), JSON_TYPE, 'a browser');
  assert.equal(pick('text/*'), JSON_TYPE, 'a wildcard never selects CSV');
  assert.equal(pick('application/xml'), JSON_TYPE, 'a type the API never produces');
});

test('text/csv is chosen when ranked strictly above JSON', () => {
  assert.equal(pick('text/csv'), CSV);
  assert.equal(pick('TEXT/CSV'), CSV, 'media types are case-insensitive');
  assert.equal(pick('text/csv, */*'), CSV, 'a wildcard does not count as JSON');
  assert.equal(pick('text/csv;charset=utf-8'), CSV, 'parameters other than q are ignored');
  assert.equal(pick('application/json;q=0.5, text/csv'), CSV);
});

test('JSON wins a preference, a tie, and a zero q', () => {
  assert.equal(pick('application/json, text/csv;q=0.5'), JSON_TYPE);
  assert.equal(pick('text/csv, application/json'), JSON_TYPE, 'a tie goes to JSON');
  assert.equal(pick('text/csv;q=0'), JSON_TYPE);
  assert.equal(negotiate('text/csv', []), JSON_TYPE, 'a route that offers nothing');
});

test('a format the route offers is served; one it does not is a 406 before validation', async (t) => {
  const app = build();
  t.after(() => app.close());

  const list = await app.inject({ method: 'GET', url: '/api/v1/references', headers: { accept: CSV } });
  assert.equal(list.statusCode, 200);
  assert.equal(list.headers['content-type'], 'text/csv; charset=utf-8; header=present');
  assert.equal(list.headers.vary, 'Accept');
  assert.equal(list.headers['content-disposition'], 'attachment; filename="references.csv"');

  for (const url of ['/api/v1/references/REF-1-00', '/api/v1/schemas', '/api/v1/schemas/SCH-1-00', '/api/v1', '/']) {
    const res = await app.inject({ method: 'GET', url, headers: { accept: CSV } });
    assert.equal(res.statusCode, 406, url);
    assert.equal(res.json().error.statusCode, 406, `${url}: the standard error shape`);
    assert.equal(res.headers.vary, 'Accept', url);
  }

  // An unknown parameter would be a 400; the 406 comes first.
  const early = await app.inject({ method: 'GET', url: '/api/v1/schemas?bogus=1', headers: { accept: CSV } });
  assert.equal(early.statusCode, 406);
});

test('JSON responses vary by Accept too, and other types still get JSON', async (t) => {
  const app = build();
  t.after(() => app.close());

  for (const accept of [undefined, 'application/xml']) {
    const res = await app.inject({ method: 'GET', url: '/api/v1/schemas', headers: accept ? { accept } : {} });
    assert.equal(res.statusCode, 200, String(accept));
    assert.match(res.headers['content-type'], /^application\/json/);
    assert.equal(res.headers.vary, 'Accept');
  }

  const missing = await app.inject({ method: 'GET', url: '/api/v1/nowhere', headers: { accept: CSV } });
  assert.equal(missing.statusCode, 404, 'an unmatched route keeps its 404');
});

test('a format parameter is not a format selector', async (t) => {
  const app = build();
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/api/v1/references?format=csv' });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error.message, /format/);
});
