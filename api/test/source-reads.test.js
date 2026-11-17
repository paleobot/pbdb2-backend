import { test } from 'node:test';
import assert from 'node:assert/strict';

import { build, DEFAULT_PUBLIC_BASE_URL as BASE } from '../src/app.js';
import { assertPublished, assertEnvelope } from './published.js';

/**
 * Reads through a payload source (authorities, collections, references, schemas), driven with a fake
 * postgres client. Every response's `data` is checked against the schema the
 * API publishes for it (the source's `out` variant, published: links as named
 * components, storage annotations gone): that schema is the response contract,
 * so a field it does not declare is a failure here (data-access, "Responses of
 * a resource with a payload source validate against its out variant";
 * api-description).
 */
const assertContract = (data) => assertPublished('Authority', data);

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

  const body = (await app.inject({ method: 'GET', url: '/api/v1/authorities/aut-1' })).json();
  assertEnvelope('single', 'Authority', body);
  const { data } = body;
  assert.deepEqual(data, {
    permid: 'aut-1',
    legacyIDs: { oldpbdbIDs: ['1'] },
    citation: 'Green 1974',
    descriptors: ['Green'],
    year: '1974',
    publishedInReference: true,
    reference: { permid: 'ref-7', title: 'Fossil leaves', href: `${BASE}/api/v1/references/ref-7` },
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

  const body = (await app.inject({ method: 'GET', url: '/api/v1/authorities' })).json();
  assertEnvelope('list', 'Authority', body);
  const { data } = body;
  assert.deepEqual(data.map((d) => d.reference), [
    { permid: 'ref-7', title: 'Fossil leaves', href: `${BASE}/api/v1/references/ref-7` },
    { permid: 'ref-9', href: `${BASE}/api/v1/references/ref-9` },
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
  assert.equal(data.reference.href, `${BASE}/api/v1/references/ref-00000000`);
  const list = (await app.inject({ method: 'GET', url: '/api/v1/authorities' })).json().data;
  assertContract(list);
});

// ---------- collections ----------

const assertCollectionContract = (data) => assertPublished('Collection', data);

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

const ref = (permid, title) => ({ permid, ...(title ? { title } : {}), href: `${BASE}/api/v1/references/${permid}` });

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
  assert.equal(data.primaryReference.href, `${BASE}/api/v1/references/ref-00000000`);
  assert.equal('country' in data || 'state' in data, false);
  assertCollectionContract((await app.inject({ method: 'GET', url: '/api/v1/collections' })).json().data);
});

// ---------- references ----------

const assertReferenceContract = (data) => assertPublished('Reference', data);

// Shaped like localhost refs: a titled journal article, an untitled one (541 PBDB
// refs have no title), and a standalone book, whose type allows different fields.
const REFERENCE_ROWS = [
  {
    permid: 'ref-1',
    payload: {
      doi: '10.1017/s0022336000040415',
      pages: { first: 718, last: 725 },
      title: 'Trilobites from the Lower Mississippian starved basin facies of the southern United States',
      authors: [{ givenName: 'D. K.', familyName: 'Brezinski' }],
      language: 'English',
      legacyIDs: { oldpbdbID: '1' },
      journalTitle: 'Journal of Paleontology',
      journalNumber: '4',
      journalVolume: '72',
      publicationType: 'journal article',
      publicationYear: '1998',
    },
  },
  {
    permid: 'ref-2',
    payload: {
      authors: [{ givenName: 'A. K.', familyName: 'Agadjanian' }],
      language: 'unknown',
      legacyIDs: { oldpbdbID: '923' },
      journalTitle: 'Paleontological Journal',
      publicationType: 'journal article',
      publicationYear: '1999',
    },
  },
  {
    permid: 'ref-3',
    payload: {
      title: 'Fossil Plants',
      authors: [{ givenName: 'A. C.', familyName: 'Seward' }],
      language: 'English',
      legacyIDs: { pbotID: 'r3' },
      publisher: 'Cambridge University Press',
      publicationCity: 'Cambridge',
      publicationType: 'standalone book',
      publicationYear: '1898',
    },
  },
];

function referencesPg() {
  const calls = [];
  return {
    calls,
    query: async (text, values) => {
      calls.push({ text, values });
      if (text.includes('WHERE permid = $1')) return { rows: REFERENCE_ROWS.filter((r) => r.permid === values[0]) };
      if (text.includes('permid = ANY')) {
        const wanted = new Set(values[0]);
        return { rows: REFERENCE_ROWS.filter((r) => wanted.has(r.permid)) };
      }
      return { rows: REFERENCE_ROWS };
    },
  };
}

test('reference single read is the stored payload with permid, in one query', async (t) => {
  const pg = referencesPg();
  const app = build({ pg });
  t.after(() => app.close());

  const { data } = (await app.inject({ method: 'GET', url: '/api/v1/references/ref-1' })).json();
  assertReferenceContract(data);
  assert.deepEqual(data, { permid: 'ref-1', ...REFERENCE_ROWS[0].payload });

  // The source declares no codecs and no child tables: no lookup, no child query.
  assert.equal(pg.calls.length, 1);
  assert.match(pg.calls[0].text, /^SELECT permid, "reference" AS payload FROM "refs" WHERE permid = \$1/);
});

test('reference list honours the contract: titled, untitled, two publication types', async (t) => {
  const pg = referencesPg();
  const app = build({ pg });
  t.after(() => app.close());

  const { data } = (await app.inject({ method: 'GET', url: '/api/v1/references' })).json();
  assertReferenceContract(data);
  assert.deepEqual(data.map((d) => [d.permid, d.publicationType, 'title' in d]), [
    ['ref-1', 'journal article', true],
    ['ref-2', 'journal article', false],
    ['ref-3', 'standalone book', true],
  ]);
  assert.equal(pg.calls.length, 1, 'a page is one query');
});

test('reference multi-entity read honours the contract', async (t) => {
  const app = build({ pg: referencesPg() });
  t.after(() => app.close());

  const { data } = (await app.inject({ method: 'GET', url: '/api/v1/references?ids=ref-2,ref-3' })).json();
  assertReferenceContract(data);
  assert.deepEqual(data.map((d) => d.permid).sort(), ['ref-2', 'ref-3']);
});

test('reference stub read honours the contract (no DB configured)', async (t) => {
  const app = build();
  t.after(() => app.close());

  const { data } = (await app.inject({ method: 'GET', url: '/api/v1/references/ref-x' })).json();
  assertReferenceContract(data);
  assert.equal(data.publicationYear, '2026');
  assert.equal('year' in data, false);
  assertReferenceContract((await app.inject({ method: 'GET', url: '/api/v1/references' })).json().data);
});

// ---------- schemas ----------

const without = (obj, keys) => Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));

const assertSchemaContract = (data) => assertPublished('Schema', data);

// A single read carries the characters tree, which the published `Schema`
// declares through the recursive `Character` and `State` components: one
// validation covers every node.
function assertSchemaTreeContract(data) {
  assert.ok(Array.isArray(data.characters), 'a single read carries its characters');
  assertPublished('Schema', data);
}

const schemaPayload = (title) => ({
  legacyIDs: { pbotID: `p-${title}` },
  title,
  year: '2023',
  authors: [{ order: 1, givenName: 'Claire', familyName: 'Cleveland' }],
  partsPreserved: ['leaf'],
});
// Three schema heads (ids and reference_id as strings, as node-postgres returns
// bigints), sharing REFS_ROWS with the authorities above:
//   sch-1: primary ref 7, repeated among its child rows beside untitled ref 9
//   sch-2: an untitled primary (ref 9); no child rows
//   sch-3: a removed primary (ref 12), and a removed child row beside ref 7
const SCHEMA_ROWS = [
  { id: '4', permid: 'sch-1', payload: schemaPayload('Alpha'), reference_id: '7' },
  { id: '5', permid: 'sch-2', payload: schemaPayload('Beta'), reference_id: '9' },
  { id: '6', permid: 'sch-3', payload: schemaPayload('Gamma'), reference_id: '12' },
];
const SCHEMA_CHILD_ROWS = [
  { parent: '4', id: '2', reference_id: '9' },
  { parent: '4', id: '1', reference_id: '7' },
  { parent: '6', id: '3', reference_id: '7' },
  { parent: '6', id: '4', reference_id: '12' },
];
// The tree under sch-1, as the recursive query returns it: a character under a
// character, a state under a state, and a quantitative state.
const SCHEMA_TREE_ROW = {
  characters: [
    { id: 1, permid: 'chr-1', payload: { legacyIDs: { pbotID: 'c1' }, name: 'Leaf', definition: 'The lamina' }, sortOrder: 1, parentCharacterId: null },
    { id: 2, permid: 'chr-2', payload: { name: 'Margin' }, sortOrder: 1, parentCharacterId: 1 },
  ],
  states: [
    { id: 10, permid: 'stt-1', payload: { name: 'Toothed' }, quantitative: false, sortOrder: 1, parentCharacterId: 2, parentStateId: null },
    { id: 11, permid: 'stt-2', payload: { name: 'Length' }, quantitative: true, sortOrder: 2, parentCharacterId: 2, parentStateId: null },
    { id: 12, permid: 'stt-3', payload: { name: 'Serrate' }, quantitative: false, sortOrder: 1, parentCharacterId: null, parentStateId: 10 },
  ],
};

function schemasPg() {
  const calls = [];
  return {
    calls,
    query: async (text, values) => {
      calls.push({ text, values });
      if (text.includes('WITH RECURSIVE')) return { rows: [values[0] === 'sch-1' ? SCHEMA_TREE_ROW : { characters: [], states: [] }] };
      if (text.includes('FROM "refs"')) {
        const ids = new Set(values[0]);
        return { rows: REFS_ROWS.filter((r) => ids.has(r.k)) };
      }
      if (text.includes('FROM "additional_schema_refs"')) {
        const parents = new Set(values[0]);
        return { rows: SCHEMA_CHILD_ROWS.filter((r) => parents.has(r.parent)) };
      }
      if (text.includes('WHERE permid = $1')) return { rows: SCHEMA_ROWS.filter((r) => r.permid === values[0]) };
      if (text.includes('permid = ANY')) {
        const wanted = new Set(values[0]);
        return { rows: SCHEMA_ROWS.filter((r) => wanted.has(r.permid)) };
      }
      return { rows: SCHEMA_ROWS };
    },
  };
}

test('schema list: a repeated primary, no child rows, an untitled and removed references; three queries', async (t) => {
  const pg = schemasPg();
  const app = build({ pg });
  t.after(() => app.close());

  const { data } = (await app.inject({ method: 'GET', url: '/api/v1/schemas' })).json();
  assertSchemaContract(data);
  const [alpha, beta, gamma] = data;
  assert.deepEqual(alpha.primaryReference, ref('ref-7', 'Fossil leaves'));
  assert.deepEqual(alpha.additionalReferences, [ref('ref-7', 'Fossil leaves'), ref('ref-9')], 'the primary repeats, by row id');
  assert.deepEqual(beta.primaryReference, ref('ref-9'), 'an untitled primary has no title key');
  assert.deepEqual(beta.additionalReferences, [], 'no child rows');
  assert.equal(gamma.primaryReference, null, 'a removed primary');
  assert.deepEqual(gamma.additionalReferences, [ref('ref-7', 'Fossil leaves')], 'a removed child row is omitted');
  for (const item of data) {
    for (const leaked of ['id', 'reference_id', 'references', 'characters']) assert.equal(leaked in item, false, `${leaked} is absent`);
  }

  // A page costs three queries: heads, their child rows, the refs they cite.
  const [head, children, refs] = pg.calls;
  assert.match(head.text, /^SELECT permid, "schema" AS payload, id, "reference_id" FROM "schemas"/);
  assert.equal(children.text, 'SELECT "schema_id" AS parent, "id", "reference_id" FROM "additional_schema_refs" WHERE "schema_id" = ANY($1) ORDER BY id');
  assert.deepEqual([...children.values[0]].sort(), ['4', '5', '6']);
  assert.deepEqual([...refs.values[0]].sort(), ['12', '7', '9']);
  assert.equal(pg.calls.length, 3);
});

test('schema multi-entity read honours the contract', async (t) => {
  const app = build({ pg: schemasPg() });
  t.after(() => app.close());

  const { data } = (await app.inject({ method: 'GET', url: '/api/v1/schemas?ids=sch-2,sch-3' })).json();
  assertSchemaContract(data);
  assert.deepEqual(data.map((d) => d.permid).sort(), ['sch-2', 'sch-3']);
});

test('schema single read: the list item plus a merged tree, honouring the contract in parts', async (t) => {
  const pg = schemasPg();
  const app = build({ pg });
  t.after(() => app.close());

  const { data } = (await app.inject({ method: 'GET', url: '/api/v1/schemas/sch-1' })).json();
  assertSchemaTreeContract(data);
  const [item] = (await app.inject({ method: 'GET', url: '/api/v1/schemas?ids=sch-1' })).json().data;
  assert.deepEqual(without(data, ['characters']), item, 'the head is the list item');

  assert.deepEqual(data.characters, [
    {
      permid: 'chr-1',
      legacyIDs: { pbotID: 'c1' },
      name: 'Leaf',
      definition: 'The lamina',
      characters: [
        {
          permid: 'chr-2',
          name: 'Margin',
          characters: [],
          states: [
            {
              permid: 'stt-1',
              name: 'Toothed',
              quantitative: false,
              states: [{ permid: 'stt-3', name: 'Serrate', quantitative: false, states: [] }],
            },
            { permid: 'stt-2', name: 'Length', quantitative: true, states: [] },
          ],
        },
      ],
      states: [],
    },
  ]);
});

test('schema single read of an empty tree, and of a missing schema', async (t) => {
  const pg = schemasPg();
  const app = build({ pg });
  t.after(() => app.close());

  const { data } = (await app.inject({ method: 'GET', url: '/api/v1/schemas/sch-3' })).json();
  assertSchemaTreeContract(data);
  assert.equal(data.primaryReference, null);
  assert.deepEqual(data.characters, []);
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/schemas/sch-none' })).statusCode, 404);
});

test('schema stub reads honour the contract (no DB configured)', async (t) => {
  const app = build();
  t.after(() => app.close());

  const { data } = (await app.inject({ method: 'GET', url: '/api/v1/schemas/sch-x' })).json();
  assertSchemaTreeContract(data);
  assert.equal(data.characters[0].states[0].quantitative, false);
  assertSchemaContract((await app.inject({ method: 'GET', url: '/api/v1/schemas' })).json().data);
});
