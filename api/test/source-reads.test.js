import { test } from 'node:test';
import assert from 'node:assert/strict';

import { build } from '../src/app.js';
import { authoritySource } from '../../payloadSchemas/authority.schema.js';
import { deriveVariant } from '../../payloadSchemas/lib/variants.js';
import { createAjv } from '../../payloadSchemas/lib/ajv.js';

/**
 * Reads through a payload source (authorities), driven with a fake postgres
 * client. Every response's `data` is checked against the authority `out`
 * variant: that schema is the response contract, so a field it does not
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
