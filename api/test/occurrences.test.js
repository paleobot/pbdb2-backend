import { test } from 'node:test';
import assert from 'node:assert/strict';

import { build, DEFAULT_PUBLIC_BASE_URL as BASE } from '../src/app.js';
import { makeOccurrenceRepository } from '../src/lib/occurrence-repository.js';
import { csvColumns } from '../src/lib/csv.js';
import { occurrenceSource } from '../../payloadSchemas/occurrence.schema.js';
import { assertPublished, assertEnvelope } from './published.js';
import { readCsv } from './csv-parse.js';

/**
 * The `occurrences` group and its nested identifications (occurrence-reads),
 * with no database: a fake postgres answers each query by its shape, returning
 * rows as the real statements would. Everything is checked against the
 * published `Occurrence` and `Identification` components.
 */

const OCC = 'OCC-131786-68';          // an occurrence whose reidentification wins
const WINNER = 'OCC-10000002-23';
const ORPHAN = 'OCC-936707-23';       // identified as a taxon permid with no taxa row

// Cache rows as occurrence-repository.js selects them (links already resolved).
const OCCURRENCE_ROWS = [
  {
    permid: OCC,
    ranks: { genus: { name: 'Dielasma' }, species: { name: 'bovidens', resolution: 'cf.' } },
    plant_organs: ['leaf'],
    oldpbdb_occurrence_no: 131786,
    taxon_permid: 'TXN-2-00',
    winner_permid: WINNER,
    taxon_name: 'Dielasma junior',
    abundance: { unit: 'specimens', value: '4', legacyIDs: { oldpbdbID: '1' } },
    collection: { permid: 'COL-1-00', name: 'A quarry' },
    reference: { permid: 'REF-1-00', title: 'Where it was found' },
    'identification.reference': { permid: 'REF-2-00', title: 'Where it was renamed' },
    acceptedTaxon: { permid: 'TXN-1-00', name: 'Dielasma senior' },
  },
  {
    permid: ORPHAN,
    ranks: { genus: { resolution: '?', name: 'Osperlioceras' }, species: { name: 'sp.' } },
    plant_organs: null,
    oldpbdb_occurrence_no: null,
    taxon_permid: 'TXN-9-00',
    winner_permid: ORPHAN,
    taxon_name: null,
    abundance: null,
    collection: { permid: 'COL-1-00', name: 'A quarry' },
    reference: { permid: 'REF-1-00', title: 'Where it was found' },
    'identification.reference': { permid: 'REF-1-00', title: 'Where it was found' },
    acceptedTaxon: null,
  },
];

// Identification heads as the nested reads select them.
const IDENTIFICATION_ROWS = [
  {
    occurrence_permid: OCC, permid: OCC, taxon_permid: 'TXN-3-00', reference_id: '1',
    payload: { identification: { genus: { name: 'Zosterophyllum' } }, plantOrgans: ['leaf'], legacyIDs: { oldpbdbID: '131786' } },
  },
  {
    occurrence_permid: OCC, permid: WINNER, taxon_permid: 'TXN-2-00', reference_id: '2',
    payload: {
      identification: { genus: { name: 'Dielasma' }, species: { name: 'bovidens', resolution: 'cf.' } },
      comments: 'Reidentified', legacyIDs: { oldpbdbID: '131786', oldpbdbReidID: '3' },
    },
  },
  {
    occurrence_permid: ORPHAN, permid: ORPHAN, taxon_permid: null, reference_id: '1',
    payload: { identification: {} },
  },
];

const TAXA = [{ k: 'TXN-2-00', v: 'TXN-2-00', l0: 'Dielasma junior' }, { k: 'TXN-3-00', v: 'TXN-3-00', l0: 'Zosterophyllum' }];
const REFS = [
  { k: '1', v: 'REF-1-00', l0: 'Where it was found', removed: false },
  { k: '2', v: 'REF-2-00', l0: 'Where it was renamed', removed: false },
];

/** A fake pg answering each statement by its shape. Rows are cloned per call: hydration mutates. */
function fakeOccurrencePg() {
  const calls = [];
  const clone = (rows) => rows.map((row) => structuredClone(row));
  return {
    calls,
    async query(text, values = []) {
      calls.push({ text, values });
      if (text.startsWith('WITH RECURSIVE')) return { rows: [{ permid: 'TXN-1-00' }, { permid: 'TXN-2-00' }] };
      if (text.startsWith('SELECT 1 FROM occurrences')) {
        return { rows: OCCURRENCE_ROWS.some((r) => r.permid === values[0]) ? [{}] : [] };
      }
      if (/FROM "taxa"/.test(text)) return { rows: clone(TAXA) };
      if (/FROM "refs"/.test(text)) return { rows: clone(REFS) };
      if (/FROM identifications i/.test(text)) {
        let rows = IDENTIFICATION_ROWS;
        if (/i\.permid = \$1 AND i\.occurrence_permid = \$2/.test(text)) {
          rows = rows.filter((r) => r.permid === values[0] && r.occurrence_permid === values[1]);
        } else {
          rows = rows.filter((r) => r.occurrence_permid === values[0]);
        }
        return { rows: clone(rows) };
      }
      if (/FROM occurrences o/.test(text)) {
        const rows = /WHERE o\.permid = \$1/.test(text)
          ? OCCURRENCE_ROWS.filter((r) => r.permid === values[0])
          : OCCURRENCE_ROWS;
        return { rows: clone(rows) };
      }
      throw new Error(`unexpected query: ${text}`);
    },
  };
}

const app = (t, opts = { pg: fakeOccurrencePg() }) => {
  const instance = build(opts);
  t.after(() => instance.close());
  return instance;
};
const get = (instance, url, headers = {}) => instance.inject({ method: 'GET', url, headers });

const NESTED_LIST = `/api/v1/occurrences/${OCC}/identifications`;
const NESTED_SINGLE = `${NESTED_LIST}/${WINNER}`;

// ---------- 6.1 routing ----------

test('write verbs on occurrences answer 405 with Allow', async (t) => {
  const instance = app(t);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    for (const url of ['/api/v1/occurrences', `/api/v1/occurrences/${OCC}`]) {
      const res = await instance.inject({ method, url });
      assert.equal(res.statusCode, 405, `${method} ${url}`);
      assert.equal(res.headers.allow, 'GET, HEAD, OPTIONS');
    }
  }
  // The nested routes are not a group: no write verbs at all.
  assert.equal((await instance.inject({ method: 'POST', url: NESTED_LIST })).statusCode, 404);
});

test('with no database every occurrence read answers 503', async (t) => {
  const instance = app(t, {});
  for (const url of ['/api/v1/occurrences', `/api/v1/occurrences/${OCC}`, NESTED_LIST, NESTED_SINGLE]) {
    const res = await get(instance, url);
    assert.equal(res.statusCode, 503, url);
    assert.match(res.json().error.message, /requires a PostgreSQL connection/);
  }
});

test('an unknown parameter is a 400 naming it on all four reads', async (t) => {
  const instance = app(t);
  for (const url of ['/api/v1/occurrences', `/api/v1/occurrences/${OCC}`, NESTED_LIST, NESTED_SINGLE]) {
    const res = await get(instance, `${url}?bogus=1`);
    assert.equal(res.statusCode, 400, url);
    assert.match(res.json().error.message, /`bogus`/);
  }
  // A link filter is an occurrence-list parameter only.
  assert.equal((await get(instance, `${NESTED_LIST}?taxon=TXN-1-00`)).statusCode, 400);
});

test('link filter values: a wrong prefix, not a permid, empty or repeated are 400s', async (t) => {
  const instance = app(t);
  const cases = [
    ['collection=TXN-1-00', /`collection` must be a COL permid/],
    ['collection=123', /`collection` must be a COL permid/],
    ['withinTaxon=COL-1-00', /`withinTaxon` must be a TXN permid/],
    ['taxon=', /`taxon` must have a value/],
    ['taxon=TXN-1-00&taxon=TXN-2-00', /`taxon` must be sent once/],
  ];
  for (const [query, message] of cases) {
    const res = await get(instance, `/api/v1/occurrences?${query}`);
    assert.equal(res.statusCode, 400, query);
    assert.match(res.json().error.message, message, query);
  }
});

test('the nested reads offer no CSV', async (t) => {
  const instance = app(t);
  for (const url of [NESTED_LIST, NESTED_SINGLE, `/api/v1/occurrences/${OCC}`]) {
    assert.equal((await get(instance, url, { accept: 'text/csv' })).statusCode, 406, url);
  }
});

test('unknown occurrences and identifications of another occurrence are 404s', async (t) => {
  const instance = app(t);
  assert.equal((await get(instance, '/api/v1/occurrences/OCC-1-00')).statusCode, 404);
  assert.equal((await get(instance, '/api/v1/occurrences/OCC-1-00/identifications')).statusCode, 404);
  assert.equal((await get(instance, `/api/v1/occurrences/OCC-1-00/identifications/${WINNER}`)).statusCode, 404);
  assert.equal((await get(instance, `/api/v1/occurrences/${ORPHAN}/identifications/${WINNER}`)).statusCode, 404);
});

// ---------- 6.2 representation ----------

test('an occurrence single read: field order, lifted ranks, two references, abundance', async (t) => {
  const res = await get(app(t), `/api/v1/occurrences/${OCC}`);
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assertEnvelope('single', 'Occurrence', body);
  assert.equal(body.meta.type, 'occurrence');
  const { data } = body;

  assert.deepEqual(Object.keys(data), [
    'permid', 'collection', 'reference', 'identification', 'acceptedTaxon', 'plantOrgans', 'abundance', 'legacyIDs',
  ]);
  assert.deepEqual(Object.keys(data.identification), [
    'permid', 'href', 'name', 'genus', 'species', 'taxon', 'reference',
  ]);
  assert.equal('identification' in data.identification, false, 'the ranks are lifted');
  assert.deepEqual(data.identification.species, { resolution: 'cf.', name: 'bovidens' }, 'resolution first');
  assert.equal(data.identification.name, 'Dielasma cf. bovidens');
  assert.equal(data.identification.href, `${BASE}/api/v1/occurrences/${OCC}/identifications/${WINNER}`);

  // The root's reference and the winner's are kept apart.
  assert.equal(data.reference.permid, 'REF-1-00');
  assert.equal(data.identification.reference.permid, 'REF-2-00');
  assert.equal(data.identification.reference.href, `${BASE}/api/v1/references/REF-2-00`);

  assert.deepEqual(data.collection, { permid: 'COL-1-00', name: 'A quarry', href: `${BASE}/api/v1/collections/COL-1-00` });
  assert.deepEqual(data.identification.taxon, { permid: 'TXN-2-00', name: 'Dielasma junior', href: `${BASE}/api/v1/taxa/TXN-2-00` });
  assert.deepEqual(data.acceptedTaxon, { permid: 'TXN-1-00', name: 'Dielasma senior', href: `${BASE}/api/v1/taxa/TXN-1-00` });
  assert.deepEqual(data.abundance, { value: '4', unit: 'specimens' }, 'value and unit only');
  assert.deepEqual(data.legacyIDs, { oldpbdbID: '131786' });
});

test('an orphan taxon is its permid alone, with no href, and has no accepted taxon', async (t) => {
  const { data } = (await get(app(t), `/api/v1/occurrences/${ORPHAN}`)).json();
  assertPublished('Occurrence', data);
  assert.deepEqual(data.identification.taxon, { permid: 'TXN-9-00' });
  assert.equal(data.acceptedTaxon, null);
  assert.equal(data.abundance, null);
  assert.equal('plantOrgans' in data, false);
  assert.equal('legacyIDs' in data, false);
  assert.equal(data.identification.name, '? Osperlioceras sp.');
});

test('no internal column reaches an occurrence', async (t) => {
  const { data } = (await get(app(t), '/api/v1/occurrences')).json();
  assertPublished('Occurrence', data);
  const text = JSON.stringify(data);
  for (const internal of ['winner_permid', 'taxon_name', 'ranks', 'oldpbdb_occurrence_no', 'winningIdentificationId', 'createdAt']) {
    assert.equal(text.includes(internal), false, internal);
  }
  assert.doesNotMatch(text, /"id":/);
});

test('an occurrence\'s identifications: the root first, each a full record with links', async (t) => {
  const body = (await get(app(t), NESTED_LIST)).json();
  assertEnvelope('list', 'Identification', body);
  assert.equal(body.meta.type, 'identification');
  assert.deepEqual(body.data.map((r) => r.permid), [OCC, WINNER]);

  const [root, winner] = body.data;
  assert.deepEqual(Object.keys(winner), ['permid', 'name', 'identification', 'taxon', 'reference', 'comments', 'legacyIDs']);
  assert.equal(winner.name, 'Dielasma cf. bovidens');
  assert.deepEqual(winner.identification.species, { resolution: 'cf.', name: 'bovidens' }, 'the ranks stay nested');
  assert.equal(winner.taxon.href, `${BASE}/api/v1/taxa/TXN-2-00`);
  assert.equal(winner.reference.href, `${BASE}/api/v1/references/REF-2-00`);
  assert.deepEqual(root.plantOrgans, ['leaf']);
});

test('one identification\'s full record, and one whose name did not resolve', async (t) => {
  const instance = app(t);
  const body = (await get(instance, NESTED_SINGLE)).json();
  assertEnvelope('single', 'Identification', body);
  assert.equal(body.data.permid, WINNER);

  const unresolved = (await get(instance, `/api/v1/occurrences/${ORPHAN}/identifications/${ORPHAN}`)).json();
  assertEnvelope('single', 'Identification', unresolved);
  assert.equal(unresolved.data.taxon, null);
  assert.equal(unresolved.data.name, null);
});

// ---------- filters, at the repository ----------

test('filters compose into one statement; a whole-subtree filter is resolved once per request', async () => {
  const pg = fakeOccurrencePg();
  const repository = makeOccurrenceRepository({ pg });
  const fields = { collection: 'COL-1-00', withinTaxon: 'TXN-2-00', taxon: 'TXN-2-00' };
  await repository.readHeads({ fields, page: { limit: 10 } });
  await repository.readHeads({ fields, page: { limit: 10, cursor: { permid: OCC, direction: 'next' } } });

  assert.equal(pg.calls.filter((c) => c.text.startsWith('WITH RECURSIVE')).length, 1, 'one walk for both batches');
  const reads = pg.calls.filter((c) => /FROM occurrences o/.test(c.text));
  assert.equal(reads.length, 2);
  const [first] = reads;
  assert.match(first.text, /o\.collection_id = \(SELECT id FROM collections WHERE permid = \$1 AND succeeded_by_id IS NULL\)/);
  assert.match(first.text, /o\.taxon_permid = \$2/);
  assert.match(first.text, /o\.taxon_permid = ANY\(ARRAY\(SELECT unnest\(\$3::text\[\]\)\)\)/);
  assert.deepEqual(first.values, ['COL-1-00', 'TXN-2-00', ['TXN-1-00', 'TXN-2-00'], 11]);
  assert.doesNotMatch(first.text, /removed IS NOT TRUE AND o\.|o\.removed/, 'no removed predicate on the cache');
});

test('a subtree with no names matches nothing, without reading the cache', async () => {
  const pg = fakeOccurrencePg();
  pg.query = async (text, values) => {
    pg.calls.push({ text, values });
    return { rows: [] };
  };
  const repository = makeOccurrenceRepository({ pg });
  assert.deepEqual(await repository.readHeads({ fields: { withinTaxon: 'TXN-5-00' } }), { records: [], hasMore: false });
  assert.equal(pg.calls.length, 1);
});

// ---------- 6.3 discovery, description, CSV ----------

test('discovery lists occurrences and no identifications', async (t) => {
  const body = (await get(app(t), '/api/v1')).json();
  assertEnvelope('index', undefined, body);
  assert.equal(body.data.resources.occurrences.href, `${BASE}/api/v1/occurrences`);
  assert.equal('identifications' in body.data.resources, false);
});

test('the description documents four occurrence GETs, the three link filters and no writes', async (t) => {
  const doc = (await get(app(t), '/api/v1/openapi.json')).json();
  const paths = Object.keys(doc.paths).filter((p) => p.startsWith('/api/v1/occurrences'));
  assert.deepEqual(paths.sort(), [
    '/api/v1/occurrences',
    '/api/v1/occurrences/{permid}',
    '/api/v1/occurrences/{permid}/identifications',
    '/api/v1/occurrences/{permid}/identifications/{identificationPermid}',
  ]);
  for (const path of paths) assert.deepEqual(Object.keys(doc.paths[path]), ['get'], path);

  const params = Object.fromEntries(doc.paths['/api/v1/occurrences'].get.parameters.map((p) => [p.name, p]));
  assert.deepEqual(Object.keys(params), ['ids', 'limit', 'cursor', 'collection', 'taxon', 'withinTaxon']);
  assert.equal(params.collection.schema.pattern, '^COL-\\d+-\\d{2}$');
  assert.equal(params.withinTaxon.schema.pattern, '^TXN-\\d+-\\d{2}$');
  const nested = doc.paths['/api/v1/occurrences/{permid}/identifications'].get.parameters.map((p) => p.name);
  assert.deepEqual(nested.sort(), ['cursor', 'ids', 'limit', 'permid']);
  assert.ok(doc.components.schemas.Occurrence && doc.components.schemas.Identification && doc.components.schemas.CollectionLink);
});

test('occurrence CSV columns come from the occurrence source, with no href', async (t) => {
  const names = csvColumns(occurrenceSource).map((c) => c.name);
  for (const column of [
    'identification.name', 'identification.taxon.permid', 'identification.taxon.name',
    'identification.reference.permid', 'acceptedTaxon.name', 'collection.name', 'abundance.value',
  ]) assert.ok(names.includes(column), column);
  assert.equal(names.some((n) => n.endsWith('href')), false);

  const res = await get(app(t), '/api/v1/occurrences?collection=COL-1-00&limit=5', { accept: 'text/csv' });
  assert.equal(res.statusCode, 200);
  const { header, records } = readCsv(res.body);
  assert.deepEqual(header, names);
  assert.equal(records.length, 2, 'one record per occurrence');
  const [row] = records;
  assert.equal(row['identification.reference.permid'], 'REF-2-00');
  assert.equal(row['reference.permid'], 'REF-1-00');
  assert.equal(row['identification.name'], 'Dielasma cf. bovidens');
});
