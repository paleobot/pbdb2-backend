import { test } from 'node:test';
import assert from 'node:assert/strict';

import { build } from '../src/app.js';
import { authoritySource } from '../../payloadSchemas/authority.schema.js';
import { collectionSource } from '../../payloadSchemas/collection.schema.js';
import { deriveVariant } from '../../payloadSchemas/lib/variants.js';
import { createAjv } from '../../payloadSchemas/lib/ajv.js';

/**
 * Reads through a payload source (authorities, collections), driven with a fake
 * postgres client. Every response's `data` is checked against the resource's
 * `out` variant: that schema is the response contract, so a field it does not
 * declare is a failure here (data-access, "Responses of a resource with a
 * payload source validate against its out variant").
 */
const validateOut = createAjv().compile(deriveVariant(authoritySource, 'out'));

function assertContract(data) {
  for (const item of Array.isArray(data) ? data : [data]) {
    assert.equal(validateOut(item), true, `${item.permid}: ${JSON.stringify(validateOut.errors)}`);
  }
}

// Three authority heads: one citing a titled reference, one an untitled one,
// one a soft-removed one. refs.id is a bigint, so node-postgres returns strings.
const AUTHORITY_ROWS = [
  { permid: 'aut-1', payload: { legacyIDs: { oldpbdbIDs: ['1'] }, citation: 'Green 1974', descriptors: ['Green'], year: '1974', publishedInReference: true }, reference_id: '7' },
  { permid: 'aut-2', payload: { citation: 'authority unknown', descriptors: [], year: '0', publishedInReference: false }, reference_id: '9' },
  { permid: 'aut-3', payload: { citation: 'Smith 1901', descriptors: ['Smith'], publishedInReference: false }, reference_id: '12' },
];
const REFS_ROWS = [
  { k: '7', v: 'ref-7', l0: 'Fossil leaves', removed: false },
  { k: '9', v: 'ref-9', l0: null, removed: false },
  { k: '12', v: 'ref-12', l0: 'Withdrawn', removed: true },
];

function fakePg() {
  const calls = [];
  return {
    calls,
    query: async (text, values) => {
      calls.push({ text, values });
      if (text.includes('FROM "refs"')) {
        const ids = new Set(values[0]);
        return { rows: REFS_ROWS.filter((r) => ids.has(r.k)) };
      }
      if (text.includes('WHERE permid = $1')) return { rows: AUTHORITY_ROWS.filter((r) => r.permid === values[0]) };
      if (text.includes('permid = ANY')) {
        const wanted = new Set(values[0]);
        return { rows: AUTHORITY_ROWS.filter((r) => wanted.has(r.permid)) };
      }
      return { rows: AUTHORITY_ROWS };
    },
  };
}

test('single read is the merged payload with a hydrated reference link', async (t) => {
  const pg = fakePg();
  const app = build({ pg });
  t.after(() => app.close());

  const { data } = (await app.inject({ method: 'GET', url: '/api/v1/authorities/aut-1' })).json();
  assertContract(data);
  assert.deepEqual(data, {
    permid: 'aut-1',
    legacyIDs: { oldpbdbIDs: ['1'] },
    citation: 'Green 1974',
    descriptors: ['Green'],
    year: '1974',
    publishedInReference: true,
    reference: { permid: 'ref-7', title: 'Fossil leaves', href: '/api/v1/references/ref-7' },
  });

  // The head query selects the column merge needs, with no link sub-select; one
  // lookup query reads only the ref the row cites.
  const [head, refs] = pg.calls;
  assert.match(head.text, /^SELECT permid, "authority" AS payload, "reference_id" FROM "authorities"/);
  assert.equal(head.text.includes('json_build_object'), false);
  assert.match(refs.text, /FROM "refs" WHERE succeeded_by_id IS NULL AND "id" = ANY\(\$1\)$/);
  assert.deepEqual(refs.values, [['7']]);
  assert.equal(pg.calls.length, 2);
});

test('list items honour the contract: titled, untitled and removed references', async (t) => {
  const pg = fakePg();
  const app = build({ pg });
  t.after(() => app.close());

  const { data } = (await app.inject({ method: 'GET', url: '/api/v1/authorities' })).json();
  assertContract(data);
  assert.deepEqual(data.map((d) => d.reference), [
    { permid: 'ref-7', title: 'Fossil leaves', href: '/api/v1/references/ref-7' },
    { permid: 'ref-9', href: '/api/v1/references/ref-9' },
    null,
  ]);
  // One lookup for the page, restricted to the ids the page cites.
  const refs = pg.calls.filter((c) => c.text.includes('FROM "refs"'));
  assert.equal(refs.length, 1);
  assert.deepEqual([...refs[0].values[0]].sort(), ['12', '7', '9']);
  for (const item of data) assert.equal('reference_id' in item, false, 'no internal id leaks');
});

test('multi-entity read honours the contract', async (t) => {
  const app = build({ pg: fakePg() });
  t.after(() => app.close());

  const { data } = (await app.inject({ method: 'GET', url: '/api/v1/authorities?ids=aut-2,aut-3' })).json();
  assertContract(data);
  assert.deepEqual(data.map((d) => d.permid).sort(), ['aut-2', 'aut-3']);
});

test('an empty page issues no lookup query', async (t) => {
  const pg = { calls: [], query: async (text) => { pg.calls.push(text); return { rows: [] }; } };
  const app = build({ pg });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/api/v1/authorities/aut-none' });
  assert.equal(res.statusCode, 404);
  assert.equal(pg.calls.length, 1);
});

test('stub read honours the contract (no DB configured)', async (t) => {
  const app = build();
  t.after(() => app.close());

  const { data } = (await app.inject({ method: 'GET', url: '/api/v1/authorities/aut-x' })).json();
  assertContract(data);
  assert.equal(data.reference.href, '/api/v1/references/ref-00000000');
  const list = (await app.inject({ method: 'GET', url: '/api/v1/authorities' })).json().data;
  assertContract(list);
});

// ---------- collections ----------

const validateCollectionOut = createAjv().compile(deriveVariant(collectionSource, 'out'));

function assertCollectionContract(data) {
  for (const item of Array.isArray(data) ? data : [data]) {
    assert.equal(validateCollectionOut(item), true, `${item.permid}: ${JSON.stringify(validateCollectionOut.errors)}`);
  }
}

const place = { toponym: { administrativeArea: { admin0: 'US', admin1: 'US-MT' } }, scale: 'outcrop' };
// Three collection heads, as the head query returns them: `location` selected as
// GeoJSON, `id` and `reference_id` as strings (bigints).
//   col-1: coordinates; primary ref 7, which also appears among its child rows
//          (as Classic's secondary_refs usually has it), plus untitled ref 9
//   col-2: no location column; primary ref 9; no child rows
//   col-3: a removed primary (ref 12), and a removed child row beside ref 7
const COLLECTION_ROWS = [
  { id: '101', permid: 'col-1', payload: { name: 'Alpha', location: place }, location: { type: 'Point', coordinates: [-110.25, 45.5] }, reference_id: '7' },
  { id: '102', permid: 'col-2', payload: { name: 'Beta', location: place }, location: null, reference_id: '9' },
  { id: '103', permid: 'col-3', payload: { name: 'Gamma', location: place }, location: null, reference_id: '12' },
];
// Child rows, deliberately not in id order for col-1: merge orders them by id.
const CHILD_ROWS = [
  { parent: '101', id: '31', reference_id: '9' },
  { parent: '101', id: '30', reference_id: '7' },
  { parent: '103', id: '40', reference_id: '7' },
  { parent: '103', id: '41', reference_id: '12' },
];

function collectionsPg() {
  const calls = [];
  return {
    calls,
    query: async (text, values) => {
      calls.push({ text, values });
      if (text.includes('FROM "refs"')) {
        const ids = new Set(values[0]);
        return { rows: REFS_ROWS.filter((r) => ids.has(r.k)) };
      }
      if (text.includes('FROM "additional_collection_refs"')) {
        const parents = new Set(values[0]);
        return { rows: CHILD_ROWS.filter((r) => parents.has(r.parent)) };
      }
      if (text.includes('WHERE permid = $1')) return { rows: COLLECTION_ROWS.filter((r) => r.permid === values[0]) };
      if (text.includes('permid = ANY')) {
        const wanted = new Set(values[0]);
        return { rows: COLLECTION_ROWS.filter((r) => wanted.has(r.permid)) };
      }
      return { rows: COLLECTION_ROWS };
    },
  };
}

const ref = (permid, title) => ({ permid, ...(title ? { title } : {}), href: `/api/v1/references/${permid}` });

test('collection single read: coordinates, a primary repeated among the additional references', async (t) => {
  const pg = collectionsPg();
  const app = build({ pg });
  t.after(() => app.close());

  const { data } = (await app.inject({ method: 'GET', url: '/api/v1/collections/col-1' })).json();
  assertCollectionContract(data);
  assert.deepEqual(data, {
    permid: 'col-1',
    name: 'Alpha',
    location: { ...place, coordinates: { latitude: 45.5, longitude: -110.25 } },
    primaryReference: ref('ref-7', 'Fossil leaves'),
    additionalReferences: [ref('ref-7', 'Fossil leaves'), ref('ref-9')],
  });

  // Three queries: the head (location through its codec's expression, and id to
  // find child rows), its child rows, and only the refs they and the row cite.
  const [head, children, refs] = pg.calls;
  assert.match(head.text, /^SELECT permid, "collection" AS payload, id, ST_AsGeoJSON\("location"\)::json AS "location", "reference_id" FROM "collections"/);
  assert.equal(head.text.includes('json_build_object'), false);
  assert.equal(children.text, 'SELECT "collection_id" AS parent, "id", "reference_id" FROM "additional_collection_refs" WHERE "collection_id" = ANY($1) ORDER BY id');
  assert.deepEqual(children.values, [['101']]);
  assert.deepEqual([...refs.values[0]].sort(), ['7', '9']);
  assert.equal(pg.calls.length, 3);
});

test('collection list: no coordinates, no child rows, and removed references', async (t) => {
  const pg = collectionsPg();
  const app = build({ pg });
  t.after(() => app.close());

  const { data } = (await app.inject({ method: 'GET', url: '/api/v1/collections' })).json();
  assertCollectionContract(data);
  const [, beta, gamma] = data;
  assert.equal('coordinates' in beta.location, false, 'a NULL location column emits no coordinates');
  assert.deepEqual(beta.primaryReference, ref('ref-9'), 'an untitled primary');
  assert.deepEqual(beta.additionalReferences, [], 'no child rows');
  assert.equal(gamma.primaryReference, null, 'a removed primary');
  assert.deepEqual(gamma.additionalReferences, [ref('ref-7', 'Fossil leaves')], 'a removed child row is omitted');
  for (const item of data) {
    for (const leaked of ['id', 'reference_id']) assert.equal(leaked in item, false, `${leaked} does not leak`);
    assert.equal(JSON.stringify(item).includes('Point'), false, 'no raw geometry');
  }

  // One child query and one refs query for the whole page.
  const children = pg.calls.filter((c) => c.text.includes('additional_collection_refs'));
  const refs = pg.calls.filter((c) => c.text.includes('FROM "refs"'));
  assert.equal(children.length, 1);
  assert.deepEqual([...children[0].values[0]].sort(), ['101', '102', '103']);
  assert.equal(refs.length, 1);
  assert.deepEqual([...refs[0].values[0]].sort(), ['12', '7', '9']);
});

test('collection multi-entity read honours the contract', async (t) => {
  const app = build({ pg: collectionsPg() });
  t.after(() => app.close());

  const { data } = (await app.inject({ method: 'GET', url: '/api/v1/collections?ids=col-2,col-3' })).json();
  assertCollectionContract(data);
  assert.deepEqual(data.map((d) => d.permid).sort(), ['col-2', 'col-3']);
});

test('collection stub read honours the contract (no DB configured)', async (t) => {
  const app = build();
  t.after(() => app.close());

  const { data } = (await app.inject({ method: 'GET', url: '/api/v1/collections/col-x' })).json();
  assertCollectionContract(data);
  assert.equal(data.primaryReference.href, '/api/v1/references/ref-00000000');
  assert.equal('country' in data || 'state' in data, false);
  assertCollectionContract((await app.inject({ method: 'GET', url: '/api/v1/collections' })).json().data);
});
