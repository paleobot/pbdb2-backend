import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { build } from '../../src/app.js';
import {
  setupTestDb,
  newPermid,
  seedPerson,
  insertRef,
  insertAuthority,
  insertTaxon,
} from './helpers.js';

/**
 * Taxa reads against a REAL PostgreSQL loaded with the backend schema.
 *
 * What only a real database can prove, and what the fake-pg suite therefore
 * cannot: that the `dictionaries`-schema joins resolve (those names are
 * schema-qualified and cannot pass through `bareIdent()`), that the ltree
 * column round-trips through the decoder, that the self-referential `accepted`
 * link resolves against the same table it is read from, and that a synonym's
 * chain correctly excludes the concept its own path ends at.
 *
 * Skips cleanly — never fails — when no database is reachable.
 */

let db;
let app;

// The fixture tree, root-ward:  Life > Animalia > Calymene > C. blumenbachii
const life = newPermid();
const animalia = newPermid();
const calymene = newPermid();
const blumenbachii = newPermid();
const synonym = newPermid();

before(async () => {
  db = await setupTestDb();
  if (!db.available) return;

  const personId = await seedPerson(db.pool);
  const ref = await insertRef(db.pool, {
    permid: newPermid(),
    personId,
    reference: { title: 'On the Trilobites' },
  });
  const authority = await insertAuthority(db.pool, {
    permid: newPermid(),
    personId,
    authority: { citation: 'Brongniart 1822' },
    referenceId: ref.id,
  });

  await insertTaxon(db.pool, {
    permid: life,
    name: 'Life',
    rank: 'unranked clade',
    conceptPath: [life],
  });
  await insertTaxon(db.pool, {
    permid: animalia,
    name: 'Animalia',
    rank: 'kingdom',
    containing: life,
    conceptPath: [life, animalia],
  });
  await insertTaxon(db.pool, {
    permid: calymene,
    name: 'Calymene',
    rank: 'genus',
    containing: animalia,
    conceptPath: [life, animalia, calymene],
  });
  await insertTaxon(db.pool, {
    permid: blumenbachii,
    name: 'Calymene blumenbachii',
    rank: 'species',
    containing: calymene,
    conceptPath: [life, animalia, calymene, blumenbachii],
    authorityId: authority.id,
  });

  // A synonym: a DIFFERENT row whose concept is `blumenbachii`. Its path ends at
  // that concept — which is another row's permid, not its own — so the decoder
  // must still exclude the final element.
  await insertTaxon(db.pool, {
    permid: synonym,
    name: 'Odontochile blumenbachii',
    rank: 'species',
    conceptPermid: blumenbachii,
    containing: calymene,
    conceptPath: [life, animalia, calymene, blumenbachii],
    nomenclaturalStatus: 'nomen dubium',
  });

  app = build({ pg: db.pool });
  await app.ready();
});

after(async () => {
  if (app) await app.close();
  if (db?.available) await db.teardown();
});

/** Flatten a nested chain into `[{rank, name, permid}]`, outermost first. */
function flatten(chain) {
  const out = [];
  for (let n = chain; n; n = n.containingTaxa) {
    out.push({ rank: n.rank, name: n.name, permid: n.permid, href: n.href });
  }
  return out;
}

test('dictionary values resolve to text from the dictionaries schema', async (t) => {
  if (!db.available) return t.skip(db.reason);

  const { data } = (
    await app.inject({ method: 'GET', url: `/api/v1/taxa/${blumenbachii}` })
  ).json();

  assert.equal(data.rank, 'species', 'rank joined from dictionaries.taxonomy_ranks');
  assert.equal(data.nomenclaturalStatus, null, 'no status recorded reads as null');

  const syn = (await app.inject({ method: 'GET', url: `/api/v1/taxa/${synonym}` })).json().data;
  assert.equal(syn.nomenclaturalStatus, 'nomen dubium', 'joined from nomenclatural_statuses');
});

test('a deep taxon carries its full chain, matching the adjacency walk', async (t) => {
  if (!db.available) return t.skip(db.reason);

  const { data } = (
    await app.inject({ method: 'GET', url: `/api/v1/taxa/${blumenbachii}` })
  ).json();

  // Outermost is the immediate container, nesting root-ward.
  assert.deepEqual(
    flatten(data.containingTaxa).map((n) => n.name),
    ['Calymene', 'Animalia', 'Life'],
  );

  // Independently walk `containing_concept_permid` — the PRIMARY representation
  // the path is derived from — and assert the API agrees with it.
  const { rows } = await db.pool.query(
    `WITH RECURSIVE up AS (
       SELECT permid, name, containing_concept_permid, 0 AS depth
         FROM taxa WHERE permid = $1
       UNION ALL
       SELECT t.permid, t.name, t.containing_concept_permid, up.depth + 1
         FROM taxa t JOIN up ON t.concept_permid = up.containing_concept_permid
                              AND t.permid = t.concept_permid
     )
     SELECT name FROM up WHERE depth > 0 ORDER BY depth`,
    [blumenbachii],
  );
  assert.deepEqual(
    flatten(data.containingTaxa).map((n) => n.name),
    rows.map((r) => r.name),
    'the path-derived chain equals the adjacency walk',
  );
});

test('chain entries carry hrefs into the taxa group', async (t) => {
  if (!db.available) return t.skip(db.reason);

  const { data } = (
    await app.inject({ method: 'GET', url: `/api/v1/taxa/${blumenbachii}` })
  ).json();

  for (const node of flatten(data.containingTaxa)) {
    assert.equal(node.href, `/api/v1/taxa/${node.permid}`);
  }
});

test('a root taxon has a null chain', async (t) => {
  if (!db.available) return t.skip(db.reason);

  const { data } = (await app.inject({ method: 'GET', url: `/api/v1/taxa/${life}` })).json();
  assert.equal(data.containingTaxa, null);
  assert.equal(data.rank, 'unranked clade');
});

test('a synonym excludes the concept its own path ends at', async (t) => {
  if (!db.available) return t.skip(db.reason);

  const { data } = (await app.inject({ method: 'GET', url: `/api/v1/taxa/${synonym}` })).json();
  const chain = flatten(data.containingTaxa);

  // The path is [Life, Animalia, Calymene, blumenbachii] and ends at the
  // synonym's CONCEPT — a different row. It is still not an ancestor.
  assert.deepEqual(
    chain.map((n) => n.name),
    ['Calymene', 'Animalia', 'Life'],
  );
  assert.ok(!chain.some((n) => n.permid === blumenbachii), 'its concept is not its ancestor');
  assert.ok(!chain.some((n) => n.permid === synonym), 'nor is it its own ancestor');
});

test('accepted resolves self-referentially to a different taxon', async (t) => {
  if (!db.available) return t.skip(db.reason);

  const { data } = (await app.inject({ method: 'GET', url: `/api/v1/taxa/${synonym}` })).json();

  assert.equal(data.name, 'Odontochile blumenbachii');
  assert.deepEqual(data.accepted, {
    name: 'Calymene blumenbachii',
    permid: blumenbachii,
    href: `/api/v1/taxa/${blumenbachii}`,
  });
});

test('an accepted name points at itself', async (t) => {
  if (!db.available) return t.skip(db.reason);

  const { data } = (
    await app.inject({ method: 'GET', url: `/api/v1/taxa/${blumenbachii}` })
  ).json();
  assert.equal(data.accepted.permid, blumenbachii);
});

test('the authority link resolves across groups', async (t) => {
  if (!db.available) return t.skip(db.reason);

  const { data } = (
    await app.inject({ method: 'GET', url: `/api/v1/taxa/${blumenbachii}` })
  ).json();

  assert.equal(data.authority.citation, 'Brongniart 1822');
  assert.match(data.authority.href, /^\/api\/v1\/authorities\//);
});

test('a taxon with no authority reads as null', async (t) => {
  if (!db.available) return t.skip(db.reason);

  const { data } = (await app.inject({ method: 'GET', url: `/api/v1/taxa/${life}` })).json();
  assert.equal(data.authority, null);
});

test('the list paginates and omits the chain unless asked', async (t) => {
  if (!db.available) return t.skip(db.reason);

  const first = (await app.inject({ method: 'GET', url: '/api/v1/taxa?limit=2' })).json();
  assert.equal(first.data.length, 2);
  assert.ok(!('containingTaxa' in first.data[0]));
  assert.ok(first.links.next);

  // Following `next` reaches the rest without repeating.
  const second = (await app.inject({ method: 'GET', url: first.links.next })).json();
  const seen = [...first.data, ...second.data].map((r) => r.permid);
  assert.equal(new Set(seen).size, seen.length, 'no record appears on two pages');

  const expanded = (
    await app.inject({ method: 'GET', url: '/api/v1/taxa?limit=2&includeContainingTaxa=true' })
  ).json();
  assert.ok('containingTaxa' in expanded.data[0]);
});

test('a multi-entity read reports missing ids and accepts the chain opt-in', async (t) => {
  if (!db.available) return t.skip(db.reason);

  const absent = newPermid();
  const body = (
    await app.inject({
      method: 'GET',
      url: `/api/v1/taxa?ids=${blumenbachii},${absent}&includeContainingTaxa=true`,
    })
  ).json();

  assert.equal(body.meta.requested, 2);
  assert.deepEqual(body.meta.missing, [absent]);
  assert.equal(body.data.length, 1);
  assert.equal(flatten(body.data[0].containingTaxa).length, 3);
});

test('write verbs are refused against a real database', async (t) => {
  if (!db.available) return t.skip(db.reason);

  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const res = await app.inject({ method, url: `/api/v1/taxa/${blumenbachii}` });
    assert.equal(res.statusCode, 405, method);
  }

  // And nothing was written.
  const { rows } = await db.pool.query('SELECT count(*)::int AS n FROM taxa');
  assert.equal(rows[0].n, 5, 'the fixture tree is untouched');
});
