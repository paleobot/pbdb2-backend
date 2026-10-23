import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { build } from '../../src/app.js';
import { assertPublished } from '../published.js';
import { setupTestDb, seedPerson, newPermid, insertRef } from './helpers.js';

/**
 * The shared-field filters on `references` (doi, title, authors, firstAuthor,
 * publicationYear) against real PostgreSQL: what each predicate *means* (case,
 * accents, DOI prefixes, range ends, absent fields), which the fake-pg unit
 * tests cannot evaluate. The file has its own database, so a plain list sees
 * only the fixtures below. Skips cleanly when no database is reachable.
 */
let ctx = { available: false, reason: 'not initialized' };
let app;
const refs = {};

// 1950: outside every year and range the year tests ask for.
const ja = (fields) => ({ publicationType: 'journal article', publicationYear: '1950', ...fields });
const author = (familyName) => ({ givenName: 'A.', familyName });

const FIXTURES = {
  doiUrl: ja({ title: 'A', doi: 'https://doi.org/10.1234/ABC' }),
  doiTwin: ja({ title: 'B', doi: '10.1234/abc' }),
  doiOther: ja({ title: 'C', doi: 'http://hdl.handle.net/2246/3564' }),
  archosaurs: ja({ title: 'Archosaurs of the <i>Late</i> Triassic', authors: [author('Reisz'), author('Sues')] }),
  pliocene: ja({ title: 'Faunes du Pliocène', authors: [author('Schröder')] }),
  percent: ja({ title: '100% of the fauna', authors: [author('Sues')] }),
  fuente: ja({ title: 'D', authors: [author('de la Fuente')] }),
  y1989: ja({ title: 'E', publicationYear: '1989' }),
  y1990: ja({ title: 'F', publicationYear: '1990' }),
  y2000: ja({ title: 'G', publicationYear: '2000' }),
  y2001: ja({ title: 'H', publicationYear: '2001' }),
  y79: ja({ title: 'I', publicationYear: '79' }),
  bare: { publicationType: 'other', publicationYear: '1950' },
};

before(async () => {
  ctx = await setupTestDb();
  if (!ctx.available) return;
  const personId = await seedPerson(ctx.pool);
  for (const [name, reference] of Object.entries(FIXTURES)) {
    refs[name] = await insertRef(ctx.pool, { permid: newPermid(), personId, reference });
  }
  // A superseded version carries a DOI its head does not: only heads are filtered.
  const lineage = newPermid();
  await insertRef(ctx.pool, { permid: lineage, personId, reference: ja({ title: 'old', doi: '10.9999/gone' }) });
  refs.superseded = await insertRef(ctx.pool, { permid: lineage, personId, reference: ja({ title: 'new' }) });
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

test('a DOI matches across a resolver prefix and case, and is not unique', async (t) => {
  assert.deepEqual(await names(t, q({ doi: '10.1234/abc' })), ['doiTwin', 'doiUrl']);
  assert.deepEqual(await names(t, q({ doi: 'doi:10.1234/ABC' })), ['doiTwin', 'doiUrl']);
  assert.deepEqual(await names(t, q({ doi: 'https://dx.doi.org/10.1234/Abc' })), ['doiTwin', 'doiUrl']);
  assert.deepEqual(await names(t, q({ doi: 'http://hdl.handle.net/2246/3564' })), ['doiOther']);
  assert.deepEqual(await names(t, q({ doi: '10.9999/gone' })), [], 'a superseded version is not a head');
});

test('title words match in any order, across HTML tags, ignoring case', async (t) => {
  assert.deepEqual(await names(t, q({ title: 'triassic archosaur' })), ['archosaurs']);
  assert.deepEqual(await names(t, q({ title: 'late triassic' })), ['archosaurs']);
  assert.deepEqual(await names(t, q({ title: 'triassic mammal' })), []);
});

test('title matching ignores accents and treats wildcards literally', async (t) => {
  assert.deepEqual(await names(t, q({ title: 'pliocene' })), ['pliocene']);
  assert.deepEqual(await names(t, q({ title: '%' })), ['percent']);
  assert.deepEqual(await names(t, q({ title: '_' })), []);
});

test('every named author must be present, in any position', async (t) => {
  assert.deepEqual(await names(t, q({ authors: 'sues,Reisz' })), ['archosaurs']);
  assert.deepEqual(await names(t, q({ authors: 'Sues' })), ['archosaurs', 'percent']);
});

test('author matching ignores accents and case, on the whole family name', async (t) => {
  assert.deepEqual(await names(t, q({ authors: 'schroder' })), ['pliocene']);
  assert.deepEqual(await names(t, q({ authors: 'SCHRÖDER' })), ['pliocene']);
  assert.deepEqual(await names(t, q({ authors: 'Fuente' })), []);
  assert.deepEqual(await names(t, q({ authors: 'De La Fuente' })), ['fuente']);
});

test('firstAuthor matches only the first author', async (t) => {
  assert.deepEqual(await names(t, q({ firstAuthor: 'Sues' })), ['percent']);
  assert.deepEqual(await names(t, q({ firstAuthor: 'reisz' })), ['archosaurs']);
  assert.deepEqual(await names(t, q({ firstAuthor: 'Reisz', authors: 'Sues' })), ['archosaurs']);
});

test('a year matches that year; a range includes both ends', async (t) => {
  assert.deepEqual(await names(t, q({ publicationYear: '1990' })), ['y1990']);
  assert.deepEqual(await names(t, q({ publicationYear: '1990-2000' })), ['y1990', 'y2000']);
  assert.deepEqual(await names(t, q({ publicationYear: '1990-1990' })), ['y1990']);
});

test('a stored year that is not four digits never matches', async (t) => {
  const all = await names(t, q({ publicationYear: '0001-9999' }));
  assert.equal(all.includes('y79'), false);
  assert.equal(all.includes('y1989'), true);
});

test('a reference without the field never matches a filter on it', async (t) => {
  for (const params of [{ title: 'a' }, { authors: 'Sues' }, { firstAuthor: 'Sues' }, { doi: '10.1234/abc' }]) {
    assert.equal((await names(t, q(params))).includes('bare'), false, JSON.stringify(params));
  }
});

test('the shared-field filters compose with each other, publicationType and ids', async (t) => {
  assert.deepEqual(await names(t, q({ firstAuthor: 'Reisz', publicationYear: '1900-2000', title: 'triassic' })), ['archosaurs']);
  assert.deepEqual(await names(t, q({ firstAuthor: 'Reisz', publicationYear: '2000' })), []);
  assert.deepEqual(await names(t, q({ authors: 'Sues', publicationType: 'other' })), []);
  if (!ctx.available) return;
  const ids = [refs.archosaurs.permid, refs.pliocene.permid].join(',');
  assert.deepEqual(await names(t, q({ ids, authors: 'Sues' })), ['archosaurs']);
});
