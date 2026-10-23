import { test } from 'node:test';
import assert from 'node:assert/strict';

import { build } from '../src/app.js';
import { listQuerySchema } from '../src/lib/query-schemas.js';
import { descriptorFor } from '../src/lib/resource-tables.js';
import { referenceSource } from '../../payloadSchemas/reference.schema.js';

/**
 * Query parameters are validated against each route's declared querystring
 * schema (query-schemas.js), normalized first so coercion loosens nothing, and
 * reported with the messages the hand-written checks gave. The other suites
 * (field-filters, pagination, multi-get, taxa) assert the existing rules; these
 * cover what the schema route adds.
 */

const emptyPg = () => ({ query: async () => ({ rows: [] }) });

async function get(url) {
  const app = build({ pg: emptyPg() });
  try {
    const res = await app.inject({ method: 'GET', url });
    return { status: res.statusCode, body: res.json() };
  } finally {
    await app.close();
  }
}

const badRequest = async (url, message) => {
  const { status, body } = await get(url);
  assert.equal(status, 400, url);
  assert.deepEqual(Object.keys(body), ['error']);
  assert.equal(body.error.statusCode, 400);
  assert.equal(body.error.error, 'BadRequestError');
  if (message) assert.equal(body.error.message, message, url);
  return body.error.message;
};

test('a filter on a source enum declares that enum, in order; one without stays open', () => {
  const { publicationType } = listQuerySchema({ ...descriptorFor('references') }).properties;
  assert.deepEqual(publicationType.enum, referenceSource.properties.publicationType.enum);
  const onTitle = listQuerySchema({ filters: { title: { jsonPath: 'title', op: 'eq' } }, source: referenceSource });
  assert.equal('enum' in onTitle.properties.title, false);
  assert.equal(onTitle.properties.title.minLength, 1);
});

test('the declared parameters are accepted and any other is a 400 naming it', async () => {
  const schema = listQuerySchema({ ...descriptorFor('references') });
  const values = {
    ids: 'r-1', limit: '5', cursor: undefined, publicationType: 'other',
    doi: '10.1234/abc', title: 'triassic archosaur', authors: 'Sues,Reisz', firstAuthor: 'Sues',
    publicationYear: '1990-2000', journalTitle: 'Palaeontology', seriesTitle: 'American Museum Novitates',
    bookTitle: 'The Dinosauria', publisher: 'Elsevier', publicationCity: 'Washington, D.C.', bookType: 'novel',
  };
  for (const param of Object.keys(schema.properties)) {
    if (values[param] === undefined) continue;
    assert.equal((await get(`/api/v1/references?${param}=${encodeURIComponent(values[param])}`)).status, 200, param);
  }
  await badRequest(
    '/api/v1/references?colour=blue&size=2',
    'Unrecognized query parameters: `colour`, `size`. This resource accepts `ids`, `limit`, `cursor`, `publicationType`, `doi`, `title`, ' +
      '`authors`, `firstAuthor`, `publicationYear`, `journalTitle`, `seriesTitle`, `bookTitle`, `publisher`, ' +
      '`publicationCity`, `bookType`',
  );
});

test('a publicationYear that is not YYYY or YYYY-YYYY is a 400 naming both forms', async () => {
  for (const value of ['79', '1990-', '1990..2000', '19900', 'abcd', '1990-2000-2010']) {
    await badRequest(
      `/api/v1/references?publicationYear=${encodeURIComponent(value)}`,
      '`publicationYear` must be a year (YYYY) or a range (YYYY-YYYY)',
    );
  }
  await badRequest(
    '/api/v1/references?publicationYear=2000-1990',
    '`publicationYear` range 2000-1990 is reversed; write the earlier year first',
  );
});

test('the type-specific filters reject an empty value', async () => {
  for (const param of ['journalTitle', 'seriesTitle', 'bookTitle', 'publisher', 'publicationCity', 'bookType']) {
    await badRequest(`/api/v1/references?${param}=`, `\`${param}\` must have a value`);
    await badRequest(`/api/v1/references?${param}=%20`, `\`${param}\` must have a value`);
  }
});

test('the shared-field filters reject an empty value, and values their kind cannot parse', async () => {
  for (const param of ['doi', 'title', 'authors', 'firstAuthor', 'publicationYear']) {
    await badRequest(`/api/v1/references?${param}=`, `\`${param}\` must have a value`);
    await badRequest(`/api/v1/references?${param}=%20`, `\`${param}\` must have a value`);
  }
  await badRequest('/api/v1/references?authors=Sues,', '`authors` must not contain an empty name');
  await badRequest(
    '/api/v1/references?firstAuthor=Sues,Reisz',
    '`firstAuthor` takes one family name; use `authors` for several',
  );
  await badRequest('/api/v1/references?doi=doi:', '`doi` must contain a DOI after its prefix');
});

test('enteredBy is not a filter', async () => {
  const message = await badRequest('/api/v1/references?enteredBy=Smith');
  assert.match(message, /^Unrecognized query parameter: `enteredBy`\./);
});

test('surrounding whitespace is trimmed before an enum is matched', async () => {
  assert.equal((await get('/api/v1/references?publicationType=%20standalone%20book%20')).status, 200);
});

test('a limit that is not a bare digit string is rejected, not converted', async () => {
  for (const value of ['1e3', '0x10', '1.0', '+5', '-1', '0', '']) {
    await badRequest(`/api/v1/references?limit=${encodeURIComponent(value)}`, '`limit` must be a positive integer');
  }
  await badRequest('/api/v1/references?limit=1001', '`limit` accepts at most 1000');
  assert.equal((await get('/api/v1/references?limit=%2010%20')).status, 200, 'trimmed, then a bare integer');
});

test('a repeated parameter is a 400', async () => {
  await badRequest('/api/v1/references?limit=5&limit=6', '`limit` must be sent once, with a single value');
  await badRequest('/api/v1/references?ids=a&ids=b', '`ids` must be sent once, with a single value');
});

test('the old messages survive the move to schema validation', async () => {
  const types = referenceSource.properties.publicationType.enum.join(', ');
  await badRequest('/api/v1/references?publicationType=book', `\`publicationType\` must be one of: ${types}`);
  await badRequest('/api/v1/references?publicationType=%20%20', '`publicationType` must have a value');
  await badRequest('/api/v1/references?ids=%20,%20', '`ids` must contain at least one id');
  await badRequest(
    '/api/v1/references?ids=a&limit=5&cursor=x',
    '`ids` cannot be combined with `limit`/`cursor`: a multi-entity read is a single page',
  );
  await badRequest(
    '/api/v1/references?ids=a&cursor=x',
    '`ids` cannot be combined with `cursor`: a multi-entity read is a single page',
  );
  await badRequest('/api/v1/references?publicationType=book&limit=0', `\`publicationType\` must be one of: ${types}`);
  await badRequest('/api/v1/references?cursor=nope', '`cursor` is not a valid cursor; follow `links.next`/`links.prev`');
});

test('every single read, the schemas aggregate included, takes no query parameters', async () => {
  for (const group of ['references', 'authorities', 'collections', 'schemas', 'taxa', 'specimens']) {
    await badRequest(
      `/api/v1/${group}/x?bogus=1`,
      'Unrecognized query parameter: `bogus`. This resource accepts no query parameters',
    );
  }
});
