import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { build } from '../../src/app.js';
import { MAX_LIMIT } from '../../src/lib/list-filters.js';
import { setupTestDb, seedPerson, mintPermids, insertRef, mintPermid } from './helpers.js';

/**
 * RIS exports of references against a REAL PostgreSQL (ris-output): more
 * references than one batch, so a whole export spans several. The export must
 * hold one record per reference, in permid_no order, each complete; a chapter
 * exports as CHAP with its book in T2, and a serial monograph's seriesNumber
 * as M1.
 *
 * Skips cleanly when no database is reachable.
 */

const RIS = { accept: 'application/x-research-info-systems' };
const N = MAX_LIMIT + 150;

let db;
let app;
let journalPermids;
let chapterPermid;
let serialPermid;

before(async () => {
  db = await setupTestDb();
  if (!db.available) return;
  const { pool } = db;
  const personId = await seedPerson(pool);

  journalPermids = await mintPermids(pool, 'REF', N);
  await pool.query(
    `INSERT INTO refs (permid, authorizer_person_id, enterer_person_id, reference)
     SELECT p, $2, $2, jsonb_build_object(
              'title', 'Reference ' || i,
              'publicationType', 'journal article',
              'publicationYear', '2001',
              'journalTitle', 'Journal of Tests',
              'authors', jsonb_build_array(jsonb_build_object('familyName', 'Smith', 'givenName', 'A.')))
       FROM unnest($1::text[]) WITH ORDINALITY AS t(p, i)`,
    [journalPermids, personId],
  );

  chapterPermid = await mintPermid(pool, 'REF');
  await insertRef(pool, {
    permid: chapterPermid,
    personId,
    reference: {
      title: 'A chapter',
      publicationType: 'article in edited collection',
      publicationYear: '2016',
      bookTitle: 'Dinosaur Tracks',
      editors: 'P. L. Falkingham, D. Marty, & A. Richter',
      authors: [{ familyName: 'Jiménez-Hidalgo', givenName: 'E.' }],
    },
  });

  serialPermid = await mintPermid(pool, 'REF');
  await insertRef(pool, {
    permid: serialPermid,
    personId,
    reference: {
      title: 'A bulletin',
      publicationType: 'serial monograph',
      publicationYear: '2014',
      seriesTitle: 'Bulletin of the New Mexico Museum of Natural History and Science',
      seriesVolume: '62',
      seriesNumber: '2',
    },
  });

  app = build({ pg: db.pool });
  await app.ready();
});

after(async () => {
  if (app) await app.close();
  if (db?.available) await db.teardown();
});

/** The records of a RIS body, each as its lines without the ER line. */
function records(body) {
  if (body === '') return [];
  assert.ok(body.endsWith('ER  - \r\n\r\n'));
  return body
    .slice(0, -'ER  - \r\n\r\n'.length)
    .split('ER  - \r\n\r\n')
    .map((r) => r.split('\r\n').slice(0, -1));
}
const tagValue = (lines, tag) => lines.find((l) => l.startsWith(`${tag}  - `))?.slice(6);

test('a whole RIS export holds one complete record per reference, in permid_no order', async (t) => {
  if (!db.available) return t.skip(db.reason);
  const res = await app.inject({ method: 'GET', url: '/api/v1/references', headers: RIS });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'application/x-research-info-systems; charset=utf-8');

  const all = records(res.body);
  assert.equal(all.length, N + 2);
  assert.deepEqual(all.map((r) => tagValue(r, 'ID')), [...journalPermids, chapterPermid, serialPermid]);
  for (const r of all) {
    assert.match(r[0], /^TY {2}- [A-Z]+$/);
    assert.equal(r[1], `ID  - ${tagValue(r, 'ID')}`);
    assert.equal(r[2], `UR  - http://localhost:3000/api/v1/references/${tagValue(r, 'ID')}`);
    assert.equal(r[3], 'DB  - Paleobiology Database');
  }
});

test('a chapter exports as CHAP with T2; a serial monograph exports M1', async (t) => {
  if (!db.available) return t.skip(db.reason);

  const chapter = await app.inject({ method: 'GET', url: `/api/v1/references/${chapterPermid}`, headers: RIS });
  assert.equal(chapter.statusCode, 200);
  const [c] = records(chapter.body);
  assert.equal(c[0], 'TY  - CHAP');
  assert.equal(tagValue(c, 'T2'), 'Dinosaur Tracks');
  assert.equal(tagValue(c, 'A2'), 'P. L. Falkingham, D. Marty, & A. Richter');
  assert.equal(tagValue(c, 'AU'), 'Jiménez-Hidalgo, E.');

  const serial = await app.inject({ method: 'GET', url: `/api/v1/references/${serialPermid}`, headers: RIS });
  const [s] = records(serial.body);
  assert.equal(s[0], 'TY  - SER');
  assert.equal(tagValue(s, 'T2'), 'Bulletin of the New Mexico Museum of Natural History and Science');
  assert.equal(tagValue(s, 'VL'), '62');
  assert.equal(tagValue(s, 'M1'), '2', 'the series number, in the tag Zotero reads on a book');
});

test('a filtered export holds exactly the filtered records', async (t) => {
  if (!db.available) return t.skip(db.reason);
  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/references?publicationType=serial%20monograph',
    headers: RIS,
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(records(res.body).map((r) => tagValue(r, 'ID')), [serialPermid]);
});
