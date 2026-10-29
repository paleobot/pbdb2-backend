import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { build } from '../../src/app.js';
import { assertPublished } from '../published.js';
import { setupTestDb, seedPerson, mintPermid, insertRef } from './helpers.js';

/**
 * The type-specific filters on `references` (journalTitle, seriesTitle,
 * bookTitle, publisher, publicationCity, bookType) against real PostgreSQL:
 * whole-value vs word matching, accents and whitespace runs, and matching a
 * field on a type that does not allow it. The file has its own database, so a
 * plain list sees only the fixtures below. Skips cleanly when no database is
 * reachable.
 */
let ctx = { available: false, reason: 'not initialized' };
let app;
const refs = {};

const ref = (publicationType, fields) => ({ publicationType, publicationYear: '1950', title: 'T', ...fields });

const FIXTURES = {
  palaeontology: ref('journal article', { journalTitle: 'Palaeontology', publicationYear: '2015' }),
  systematic: ref('journal article', { journalTitle: 'Journal of Systematic Palaeontology', publicationYear: '2015' }),
  revue: ref('journal article', { journalTitle: 'Revue de  Paléobiologie' }),
  // A legacy journal article carrying a field its type does not allow today.
  legacyPublisher: ref('journal article', { journalTitle: 'Precambrian Research', publisher: 'Elsevier BV' }),
  novitates: ref('serial monograph', { seriesTitle: 'American Museum Novitates' }),
  elsevier: ref('standalone book', { publisher: 'Elsevier', bookType: 'monograph' }),
  thesis: ref('standalone book', { bookType: 'Ph.D. thesis', publicationCity: 'Washington, D.C.' }),
  chapter: ref('article in edited collection', { bookTitle: 'The Dinosauria' }),
  collection: ref('edited collection', { title: 'The Dinosauria' }),
};

before(async () => {
  ctx = await setupTestDb();
  if (!ctx.available) return;
  const personId = await seedPerson(ctx.pool);
  for (const [name, reference] of Object.entries(FIXTURES)) {
    refs[name] = await insertRef(ctx.pool, { permid: await mintPermid(ctx.pool, 'REF'), personId, reference });
  }
  app = build({ pg: ctx.pool });
});

after(async () => {
  if (app) await app.close();
  if (ctx.teardown) await ctx.teardown();
});

/** The fixture names a list request returns, sorted; every record checked against the published contract. */
async function names(t, query) {
  if (!ctx.available) return t.skip(ctx.reason);
  const res = await app.inject({ method: 'GET', url: `/api/v1/references?${query}` });
  assert.equal(res.statusCode, 200, `${query}: ${res.body}`);
  const byPermid = new Map(Object.entries(refs).map(([name, row]) => [row.permid, name]));
  const { data } = res.json();
  for (const record of data) assertPublished('Reference', record);
  return data.map((record) => byPermid.get(record.permid)).sort();
}

const q = (params) => new URLSearchParams(params).toString();

test('a journal title matches the whole title only', async (t) => {
  assert.deepEqual(await names(t, q({ journalTitle: 'palaeontology' })), ['palaeontology']);
  assert.deepEqual(await names(t, q({ journalTitle: 'journal of systematic palaeontology' })), ['systematic']);
  assert.deepEqual(await names(t, q({ journalTitle: 'Systematic' })), []);
});

test('a journal title ignores accents and runs of whitespace', async (t) => {
  assert.deepEqual(await names(t, q({ journalTitle: 'revue de paleobiologie' })), ['revue']);
  assert.deepEqual(await names(t, q({ journalTitle: 'Revue   de Paléobiologie' })), ['revue']);
});

test('a series title matches the whole title', async (t) => {
  assert.deepEqual(await names(t, q({ seriesTitle: 'american museum novitates' })), ['novitates']);
  assert.deepEqual(await names(t, q({ seriesTitle: 'Novitates' })), []);
});

test('publisher words match variants, on any publication type', async (t) => {
  assert.deepEqual(await names(t, q({ publisher: 'elsevier' })), ['elsevier', 'legacyPublisher']);
  assert.deepEqual(await names(t, q({ publisher: 'Elsevier BV' })), ['legacyPublisher']);
});

test('publication city words match', async (t) => {
  assert.deepEqual(await names(t, q({ publicationCity: 'washington' })), ['thesis']);
  assert.deepEqual(await names(t, q({ publicationCity: 'D.C. Washington' })), ['thesis']);
});

test('a book title matches the containing book, not an edited collection\'s own title', async (t) => {
  assert.deepEqual(await names(t, q({ bookTitle: 'dinosauria' })), ['chapter']);
});

test('bookType matches exactly; an unknown value is an empty 200', async (t) => {
  assert.deepEqual(await names(t, q({ bookType: 'Ph.D. thesis' })), ['thesis']);
  assert.deepEqual(await names(t, q({ bookType: 'ph.d. thesis' })), []);
  assert.deepEqual(await names(t, q({ bookType: 'novel' })), []);
});

test('a reference without the field never matches a filter on it', async (t) => {
  for (const param of ['journalTitle', 'seriesTitle', 'bookTitle', 'publisher', 'publicationCity', 'bookType']) {
    assert.equal((await names(t, q({ [param]: 'T' }))).includes('collection'), false, param);
  }
});

test('contradictory filters are an empty 200', async (t) => {
  assert.deepEqual(await names(t, q({ publicationType: 'journal article', bookType: 'monograph' })), []);
  assert.deepEqual(await names(t, q({ publicationType: 'standalone book', journalTitle: 'Palaeontology' })), []);
});

test('the type-specific filters compose with shared ones, publicationType and ids', async (t) => {
  assert.deepEqual(await names(t, q({ journalTitle: 'Palaeontology', publicationYear: '2010-2020' })), ['palaeontology']);
  assert.deepEqual(await names(t, q({ journalTitle: 'Palaeontology', publicationYear: '1950' })), []);
  assert.deepEqual(await names(t, q({ publisher: 'Elsevier', publicationType: 'standalone book' })), ['elsevier']);
  if (!ctx.available) return;
  const ids = [refs.elsevier.permid, refs.thesis.permid].join(',');
  assert.deepEqual(await names(t, q({ ids, publisher: 'Elsevier' })), ['elsevier']);
});
