import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { build } from '../../src/app.js';
import { MAX_LIMIT } from '../../src/lib/list-filters.js';
import { csvSerializer } from '../../src/lib/csv.js';
import { authoritySource } from '../../../payloadSchemas/authority.schema.js';
import { collectionSource } from '../../../payloadSchemas/collection.schema.js';
import { referenceSource } from '../../../payloadSchemas/reference.schema.js';
import { taxonSource } from '../../../payloadSchemas/taxon.schema.js';
import { setupTestDb, seedPerson, mintPermids } from './helpers.js';
import { readCsv } from '../csv-parse.js';

/**
 * CSV exports against a REAL PostgreSQL (csv-output): each of the four
 * resources has more rows than one batch, so an export with no `limit` spans
 * several. Each export must be exactly the JSON pages, record for record, run
 * through the same serializer: same records, same order, nothing repeated or
 * skipped at a batch boundary.
 *
 * Skips cleanly when no database is reachable.
 */

const N = MAX_LIMIT + 150;

let db;
let app;

before(async () => {
  db = await setupTestDb();
  if (!db.available) return;
  const { pool } = db;
  const personId = await seedPerson(pool);

  // Bulk inserts, so a fixture of more than one batch stays quick. Row i of each
  // resource cites reference i, and every third collection has two additional
  // references, one of them its primary.
  const refPermids = await mintPermids(pool, 'REF', N);
  await pool.query(
    `INSERT INTO refs (permid, authorizer_person_id, enterer_person_id, reference)
     SELECT p, $2, $2, jsonb_build_object(
              'title', 'Reference ' || i || ', "quoted"',
              'publicationType', 'journal article',
              'publicationYear', '2001',
              'authors', jsonb_build_array(
                jsonb_build_object('familyName', 'Smith', 'givenName', 'A'),
                jsonb_build_object('familyName', 'Ab|cd')),
              'comments', 'line one' || chr(10) || 'line two')
       FROM unnest($1::text[]) WITH ORDINALITY AS t(p, i)`,
    [refPermids, personId],
  );

  const autPermids = await mintPermids(pool, 'AUT', N);
  await pool.query(
    `INSERT INTO authorities (permid, authorizer_person_id, enterer_person_id, authority, reference_id)
     SELECT a.p, $3, $3,
            jsonb_build_object('citation', 'Author ' || a.i, 'descriptors', jsonb_build_array('x', 'y;z'),
                               'year', '2001', 'publishedInReference', true,
                               'legacyIDs', jsonb_build_object('oldpbdbIDs', jsonb_build_array(a.i::text))),
            r.id
       FROM unnest($1::text[]) WITH ORDINALITY AS a(p, i)
       JOIN unnest($2::text[]) WITH ORDINALITY AS rp(p, i) ON rp.i = a.i
       JOIN refs r ON r.permid = rp.p`,
    [autPermids, refPermids, personId],
  );

  const colPermids = await mintPermids(pool, 'COL', N);
  await pool.query(
    `INSERT INTO collections (permid, authorizer_person_id, enterer_person_id, collection, reference_id, location)
     SELECT c.p, $3, $3,
            jsonb_build_object('name', 'Collection ' || c.i,
              'location', jsonb_build_object('scale', 'outcrop'),
              'lithofacies', jsonb_build_array(
                jsonb_build_object('lithology', 'sandstone', 'adjectives', jsonb_build_array('sandy', 'fine')),
                jsonb_build_object('lithology', 'shale'))),
            r.id, ('SRID=4326;POINT(' || (c.i % 180) || ' ' || (c.i % 90) || '.5)')::geography
       FROM unnest($1::text[]) WITH ORDINALITY AS c(p, i)
       JOIN unnest($2::text[]) WITH ORDINALITY AS rp(p, i) ON rp.i = c.i
       JOIN refs r ON r.permid = rp.p`,
    [colPermids, refPermids, personId],
  );
  await pool.query(
    `INSERT INTO additional_collection_refs (authorizer_person_id, enterer_person_id, collection_id, reference_id)
     SELECT $1, $1, c.id, r.id
       FROM collections c
       JOIN refs r ON r.id IN (c.reference_id, (SELECT min(id) FROM refs))
      WHERE c.id % 3 = 0`,
    [personId],
  );

  const txnPermids = await mintPermids(pool, 'TXN', N);
  await pool.query(
    `INSERT INTO taxa
       (permid, name, rank_id, authority_id, original_permid, accepted_spelling_permid,
        concept_permid, containing_concept_permid, classification_path)
     SELECT t.p, 'Taxon ' || t.i,
            (SELECT id FROM dictionaries.taxonomy_ranks WHERE taxonomy_rank = 'genus'),
            a.id, t.p, t.p, t.p, NULL, t.p::ltree
       FROM unnest($1::text[]) WITH ORDINALITY AS t(p, i)
       JOIN unnest($2::text[]) WITH ORDINALITY AS ap(p, i) ON ap.i = t.i
       JOIN authorities a ON a.permid = ap.p`,
    [txnPermids, autPermids],
  );

  app = build({ pg: pool });
  await app.ready();
});

after(async () => {
  if (app) await app.close();
  if (db?.available) await db.teardown();
});

/** Every record of a JSON list, following `links.next` at the largest page size. */
async function allJsonRecords(path) {
  const records = [];
  let url = `${path}?limit=${MAX_LIMIT}`;
  while (url) {
    const res = await app.inject({ method: 'GET', url });
    assert.equal(res.statusCode, 200, url);
    const body = res.json();
    records.push(...body.data);
    url = body.links.next ? new URL(body.links.next).pathname + new URL(body.links.next).search : null;
  }
  return records;
}

for (const [resource, source] of [
  ['references', referenceSource],
  ['authorities', authoritySource],
  ['collections', collectionSource],
  ['taxa', taxonSource],
]) {
  test(`${resource}: an export with no limit is every JSON page, record for record`, async (t) => {
    if (!db.available) return t.skip(db.reason);

    const path = `/api/v1/${resource}`;
    const res = await app.inject({ method: 'GET', url: path, headers: { accept: 'text/csv' } });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'], /^text\/csv/);

    const json = await allJsonRecords(path);
    assert.equal(json.length, N, 'the fixture spans more than one batch');
    const serializer = csvSerializer(source);
    assert.equal(res.body, serializer.header() + json.map(serializer.record).join(''));

    const { records } = readCsv(res.body);
    assert.equal(records.length, N);
    assert.equal(new Set(records.map((r) => r.permid)).size, N, 'no record twice');
  });
}

test('flattened values read back as stored', async (t) => {
  if (!db.available) return t.skip(db.reason);
  const get = async (resource) =>
    readCsv((await app.inject({ method: 'GET', url: `/api/v1/${resource}?limit=1`, headers: { accept: 'text/csv' } })).body)
      .records[0];

  const ref = await get('references');
  assert.equal(ref.title, 'Reference 1, "quoted"');
  assert.equal(ref['authors.familyName'], 'Smith|Ab\\|cd');
  assert.equal(ref['authors.givenName'], 'A|');
  assert.equal(ref.comments, 'line one\nline two');

  const authority = await get('authorities');
  assert.equal(authority['reference.title'], 'Reference 1, "quoted"');
  assert.equal(authority.descriptors, 'x|y\\;z');
  assert.equal(authority.publishedInReference, 'true');

  const collection = await get('collections');
  assert.equal(collection['location.coordinates.latitude'], '1.5');
  assert.equal(collection['lithofacies.lithology'], 'sandstone|shale');
  assert.equal(collection['lithofacies.adjectives'], 'sandy;fine|');

  const taxon = await get('taxa');
  assert.equal(taxon.rank, 'genus');
  assert.equal(taxon['authority.citation'], 'Author 1');
  assert.equal(taxon['accepted.permid'], taxon.permid);
});
