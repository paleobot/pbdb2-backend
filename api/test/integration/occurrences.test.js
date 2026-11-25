import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { build, DEFAULT_PUBLIC_BASE_URL as BASE } from '../../src/app.js';
import {
  setupTestDb, mintPermid, mintPermids, seedPerson, insertRef, insertCollection, insertTaxon,
} from './helpers.js';
import { assertPublished, assertEnvelope } from '../published.js';
import { readCsv } from '../csv-parse.js';
import { csvColumns } from '../../src/lib/csv.js';
import { occurrenceSource } from '../../../payloadSchemas/occurrence.schema.js';

/**
 * Occurrence reads against a REAL PostgreSQL loaded with the backend schema
 * (occurrence-reads). The fixtures are identifications and an abundance,
 * inserted into the ledger tables, and the `occurrences` cache is then built by
 * the backend's own `rebuild_occurrences()`, so the winner rule, the root vs.
 * winner reference and the organs are the database's, not this file's.
 *
 * The orphan taxon is a registered TXN permid with no `taxa` row. In real data
 * it is a root name opinion's permid; `identifications.taxon_permid` references
 * only the permid registry, and the API never reads `name_opinions`, so the
 * opinion row itself would add nothing to what is tested here.
 *
 * Skips cleanly, never fails, when no database is reachable.
 */

let db;
let app;
const f = {}; // fixture permids

async function insertIdentification(pool, { permid, occurrencePermid, collectionId = null, taxonPermid = null, referenceId, personId, identification }) {
  await pool.query(
    `INSERT INTO identifications
       (permid, authorizer_person_id, enterer_person_id, occurrence_permid, collection_id, taxon_permid, reference_id, identification)
     VALUES ($1, $2, $2, $3, $4, $5, $6, $7::jsonb)`,
    [permid, personId, occurrencePermid, collectionId, taxonPermid, referenceId, JSON.stringify(identification)],
  );
}

before(async () => {
  db = await setupTestDb();
  if (!db.available) return;
  const { pool } = db;
  const personId = await seedPerson(pool);

  const r1 = await insertRef(pool, { permid: await mintPermid(pool, 'REF'), personId, reference: { title: 'Where they were found', publicationYear: '2000' } });
  const r2 = await insertRef(pool, { permid: await mintPermid(pool, 'REF'), personId, reference: { title: 'A later revision', publicationYear: '2010' } });
  Object.assign(f, { r1: r1.permid, r2: r2.permid });

  const c1 = await insertCollection(pool, { permid: await mintPermid(pool, 'COL'), personId, referenceId: r1.id, collection: { name: 'Quarry one' } });
  const c2 = await insertCollection(pool, { permid: await mintPermid(pool, 'COL'), personId, referenceId: r1.id, collection: { name: 'Quarry two' } });
  Object.assign(f, { c1: c1.permid, c2: c2.permid });

  // A genus, a species in it, and a junior synonym of the species; plus a
  // registered permid with no taxa row (the orphan).
  [f.genus, f.species, f.synonym, f.orphan] = await mintPermids(pool, 'TXN', 4);
  await insertTaxon(pool, { permid: f.genus, name: 'Dielasma', rank: 'genus', conceptPath: [f.genus] });
  await insertTaxon(pool, { permid: f.species, name: 'Dielasma bovidens', rank: 'species', containing: f.genus, conceptPath: [f.genus, f.species] });
  await insertTaxon(pool, {
    permid: f.synonym, name: 'Terebratula bovidens', rank: 'species', conceptPermid: f.species,
    containing: f.genus, conceptPath: [f.genus, f.species],
  });

  // A: recorded in r1 as the genus (naming a leaf), reidentified in r2 as the species, which wins.
  [f.a, f.aReid] = await mintPermids(pool, 'OCC', 2);
  await insertIdentification(pool, {
    permid: f.a, occurrencePermid: f.a, collectionId: c1.id, taxonPermid: f.genus, referenceId: r1.id, personId,
    identification: { identification: { genus: { name: 'Dielasma' }, species: { name: 'sp.' } }, plantOrgans: ['leaf'], legacyIDs: { oldpbdbID: '1' } },
  });
  await insertIdentification(pool, {
    permid: f.aReid, occurrencePermid: f.a, taxonPermid: f.species, referenceId: r2.id, personId,
    identification: { identification: { genus: { name: 'Dielasma' }, species: { resolution: 'cf.', name: 'bovidens' } }, comments: 'Revised' },
  });
  // B: identified as the junior synonym.  C: as the orphan.  D: as the genus, with an abundance.  E: unresolved.
  [f.b, f.c, f.d, f.e] = await mintPermids(pool, 'OCC', 4);
  const root = (permid, collectionId, taxonPermid, identification) => insertIdentification(pool, {
    permid, occurrencePermid: permid, collectionId, taxonPermid, referenceId: r1.id, personId, identification,
  });
  await root(f.b, c1.id, f.synonym, { identification: { genus: { name: 'Terebratula' }, species: { name: 'bovidens' } } });
  await root(f.c, c2.id, f.orphan, { identification: { genus: { resolution: '?', name: 'Osperlioceras' }, species: { name: 'sp.' } } });
  await root(f.d, c2.id, f.genus, { identification: { genus: { name: 'Dielasma' }, species: { name: 'sp.' } } });
  await root(f.e, c2.id, null, { identification: { genus: { resolution: 'informal', name: 'Bigfoot' } } });
  await pool.query(
    `INSERT INTO occurrence_abundances (permid, authorizer_person_id, enterer_person_id, occurrence_permid, reference_id, abundance)
     VALUES ($1, $2, $2, $3, $4, '{"value": "12", "unit": "specimens"}'::jsonb)`,
    [await mintPermid(pool, 'ABD'), personId, f.d, r1.id],
  );

  await pool.query('SELECT rebuild_occurrences()');

  app = build({ pg: pool });
  await app.ready();
});

after(async () => {
  if (app) await app.close();
  if (db?.available) await db.teardown();
});

const get = (url, headers = {}) => app.inject({ method: 'GET', url, headers });
const permidsOf = async (query) => {
  const res = await get(`/api/v1/occurrences?${query}`);
  assert.equal(res.statusCode, 200, query);
  assertPublished('Occurrence', res.json().data);
  return res.json().data.map((o) => o.permid);
};

// ---------- 7.2 reads ----------

test('the root\'s reference and the winner\'s are kept apart', async (t) => {
  if (!db.available) return t.skip(db.reason);
  const res = await get(`/api/v1/occurrences/${f.a}`);
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assertEnvelope('single', 'Occurrence', body);
  const { data } = body;
  assert.deepEqual(Object.keys(data), ['permid', 'collection', 'reference', 'identification', 'acceptedTaxon', 'plantOrgans', 'abundance']);
  assert.equal(data.reference.permid, f.r1);
  assert.equal(data.identification.reference.permid, f.r2);
  assert.equal(data.identification.reference.title, 'A later revision');
  assert.equal(data.identification.permid, f.aReid);
  assert.equal(data.identification.name, 'Dielasma cf. bovidens');
  assert.deepEqual(data.identification.taxon, { permid: f.species, name: 'Dielasma bovidens', href: `${BASE}/api/v1/taxa/${f.species}` });
  assert.deepEqual(data.collection, { permid: f.c1, name: 'Quarry one', href: `${BASE}/api/v1/collections/${f.c1}` });
  assert.deepEqual(data.plantOrgans, ['leaf'], 'the organs come from the root, not the winner');
  assert.equal('plantOrgans' in data.identification, false);
  assert.equal(data.abundance, null);
});

test('a synonym\'s accepted taxon, an orphan taxon, an unresolved name and an abundance', async (t) => {
  if (!db.available) return t.skip(db.reason);
  const b = (await get(`/api/v1/occurrences/${f.b}`)).json().data;
  assert.equal(b.identification.taxon.permid, f.synonym);
  assert.deepEqual(b.acceptedTaxon, { permid: f.species, name: 'Dielasma bovidens', href: `${BASE}/api/v1/taxa/${f.species}` });

  const c = (await get(`/api/v1/occurrences/${f.c}`)).json().data;
  assert.deepEqual(c.identification.taxon, { permid: f.orphan });
  assert.equal(c.acceptedTaxon, null);

  const d = (await get(`/api/v1/occurrences/${f.d}`)).json().data;
  assert.deepEqual(d.abundance, { value: '12', unit: 'specimens' });

  const e = (await get(`/api/v1/occurrences/${f.e}`)).json().data;
  assert.equal(e.identification.taxon, null);
  assert.equal(e.acceptedTaxon, null);
  assert.equal(e.identification.name, 'Bigfoot');
  assertPublished('Occurrence', [b, c, d, e]);
});

test('the list pages in permid order; ids reads a set; unknown permids are 404s', async (t) => {
  if (!db.available) return t.skip(db.reason);
  const seen = [];
  let url = '/api/v1/occurrences?limit=2';
  while (url) {
    const body = (await get(url.replace(BASE, ''))).json();
    assertEnvelope('list', 'Occurrence', body);
    seen.push(...body.data.map((o) => o.permid));
    url = body.links.next;
  }
  assert.deepEqual(seen, [f.a, f.b, f.c, f.d, f.e]);

  const ids = (await get(`/api/v1/occurrences?ids=${f.d},${f.b},OCC-1-00`)).json();
  assert.deepEqual(ids.data.map((o) => o.permid), [f.b, f.d]);
  assert.deepEqual(ids.meta.missing, ['OCC-1-00']);

  assert.equal((await get('/api/v1/occurrences/OCC-1-00')).statusCode, 404);
  assert.equal((await get(`/api/v1/occurrences/${f.aReid}`)).statusCode, 404, 'a reidentification is not an occurrence');
});

// ---------- 7.3 filters ----------

test('collection, exact taxon and subtree filters', async (t) => {
  if (!db.available) return t.skip(db.reason);
  assert.deepEqual(await permidsOf(`collection=${f.c1}`), [f.a, f.b]);
  assert.deepEqual(await permidsOf(`taxon=${f.genus}`), [f.d], 'the genus misses its species and A, whose root named it');
  assert.deepEqual(await permidsOf(`taxon=${f.orphan}`), [f.c], 'an exact match needs no taxa row');
  assert.deepEqual(await permidsOf(`withinTaxon=${f.genus}`), [f.a, f.b, f.d], 'species and synonym found; orphan and unresolved not');
  assert.deepEqual(await permidsOf(`withinTaxon=${f.synonym}`), await permidsOf(`withinTaxon=${f.species}`), 'a synonym selects its senior\'s subtree');
  assert.deepEqual(await permidsOf(`withinTaxon=${f.species}`), [f.a, f.b]);
  assert.deepEqual(await permidsOf(`withinTaxon=${f.orphan}`), []);
  assert.deepEqual(await permidsOf(`collection=${f.c2}&withinTaxon=${f.genus}`), [f.d], 'filters combine');
  assert.deepEqual(await permidsOf(`ids=${f.a},${f.d}&collection=${f.c1}`), [f.a], 'and compose with ids');
  assert.deepEqual(await permidsOf('taxon=TXN-999999-99'), [], 'a well-formed permid naming nothing');
  assert.deepEqual(await permidsOf('collection=COL-999999-99'), []);
  assert.equal((await get('/api/v1/occurrences?collection=TXN-1-00')).statusCode, 400);
});

// ---------- 7.4 nested ----------

test('an occurrence\'s identifications: the root first, each full record valid', async (t) => {
  if (!db.available) return t.skip(db.reason);
  const body = (await get(`/api/v1/occurrences/${f.a}/identifications`)).json();
  assertEnvelope('list', 'Identification', body);
  assert.deepEqual(body.data.map((i) => i.permid), [f.a, f.aReid]);
  const [rootId, reid] = body.data;
  assert.deepEqual(rootId.identification, { genus: { name: 'Dielasma' }, species: { name: 'sp.' } }, 'ranks nested, as stored');
  assert.equal(rootId.taxon.permid, f.genus);
  assert.equal(rootId.reference.permid, f.r1);
  assert.deepEqual(rootId.legacyIDs, { oldpbdbID: '1' });
  assert.equal(reid.comments, 'Revised');
  assert.equal(reid.reference.href, `${BASE}/api/v1/references/${f.r2}`);

  const orphan = (await get(`/api/v1/occurrences/${f.c}/identifications/${f.c}`)).json();
  assertEnvelope('single', 'Identification', orphan);
  assert.deepEqual(orphan.data.taxon, { permid: f.orphan }, 'no name and no href in the full record either');
  const unresolved = (await get(`/api/v1/occurrences/${f.e}/identifications/${f.e}`)).json().data;
  assert.equal(unresolved.taxon, null);
});

test('the embedded identification links to the winner\'s full record; other occurrences\' are 404s', async (t) => {
  if (!db.available) return t.skip(db.reason);
  const { identification } = (await get(`/api/v1/occurrences/${f.a}`)).json().data;
  const res = await get(identification.href.replace(BASE, ''));
  assert.equal(res.statusCode, 200);
  assertEnvelope('single', 'Identification', res.json());
  assert.equal(res.json().data.permid, identification.permid);

  assert.equal((await get(`/api/v1/occurrences/${f.b}/identifications/${f.aReid}`)).statusCode, 404);
  assert.equal((await get('/api/v1/occurrences/OCC-1-00/identifications')).statusCode, 404);
  assert.equal((await get(`/api/v1/occurrences/${f.aReid}/identifications`)).statusCode, 404, 'a reidentification is not an occurrence');
});

// ---------- 7.5 CSV ----------

test('CSV: a filtered export has one record per occurrence; a whole export streams', async (t) => {
  if (!db.available) return t.skip(db.reason);
  const columns = csvColumns(occurrenceSource).map((c) => c.name);
  const filtered = await get(`/api/v1/occurrences?collection=${f.c1}`, { accept: 'text/csv' });
  assert.equal(filtered.statusCode, 200);
  const { header, records } = readCsv(filtered.body);
  assert.deepEqual(header, columns);
  assert.deepEqual(records.map((r) => r.permid), [f.a, f.b]);
  assert.equal(records[0]['reference.permid'], f.r1);
  assert.equal(records[0]['identification.reference.permid'], f.r2);
  assert.equal(records[0]['identification.taxon.name'], 'Dielasma bovidens');
  assert.equal(records[1]['acceptedTaxon.name'], 'Dielasma bovidens');

  const whole = await get(`/api/v1/occurrences?withinTaxon=${f.genus}`, { accept: 'text/csv' });
  assert.equal(whole.statusCode, 200);
  assert.deepEqual(readCsv(whole.body).records.map((r) => r.permid), [f.a, f.b, f.d]);
});
