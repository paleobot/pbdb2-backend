import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveVariant } from '../lib/variants.js';
import { applyEnums } from '../lib/enums.js';
import { createAjv } from '../lib/ajv.js';
import { link } from '../lib/links.js';

const source = () => ({
  $schema: 'https://json-schema.org/draft/2019-09/schema',
  $id: 'https://pbdb2.example.com/schemas/thing.json',
  type: 'object',
  properties: {
    permid: { type: 'string', readOnly: true, 'x-storage': { column: 'permid' } },
    legacyIDs: { type: 'object', readOnly: true, properties: { oldpbdbID: { type: 'string' } } },
    name: { type: 'string' },
    kind: { type: 'string', 'x-enumFrom': { table: 'kinds', column: 'name' } },
    unit: { type: 'string', enum: ['meters', 'feet'] },
    place: {
      type: 'object',
      properties: {
        lat: { type: 'number', 'x-storage': { column: 'location', codec: 'wgs84Point' } },
        lng: { type: 'number', 'x-storage': { column: 'location', codec: 'wgs84Point' } },
        basis: { type: 'string' },
      },
      required: ['basis', 'lat'],
      'x-create': { required: ['lng'] },
    },
  },
  required: ['name', 'permid'],
  'x-create': { required: ['place'] },
  unevaluatedProperties: false,
});
const resolved = () => applyEnums(source(), new Map([['kinds.name', ['a', 'b']]]));
const compile = (variant) => createAjv().compile(deriveVariant(resolved(), variant));

test('source is not mutated by any variant', () => {
  const src = resolved();
  const before = structuredClone(src);
  for (const v of ['db', 'in-create', 'out', 'patch-guard']) deriveVariant(src, v);
  assert.deepEqual(src, before);
});

test('unknown variant lists the valid ones', () => {
  assert.throws(() => deriveVariant(source(), 'in-update'), /db, in-create, patch-guard, out/);
});

test('nested readOnly: kept in db and out, dropped and pruned from required in in-create', () => {
  const s = source();
  s.properties.place.properties.basis.readOnly = true;
  const derived = (v) => deriveVariant(s, v);
  assert.ok(derived('db').properties.place.properties.basis);
  assert.ok(derived('out').properties.place.properties.basis);
  const create = derived('in-create').properties.place;
  assert.equal(create.properties.basis, undefined);
  assert.deepEqual(create.required, ['lat']);
});

// A source with one link property, as authority.reference is declared.
const linkSource = () => ({
  $schema: 'https://json-schema.org/draft/2019-09/schema',
  $id: 'https://pbdb2.example.com/schemas/cites.json',
  type: 'object',
  properties: {
    reference: { ...link({ target: 'references', label: 'title' }), 'x-storage': { column: 'reference_id', codec: 'referencePermid' } },
  },
  required: ['reference'],
  unevaluatedProperties: false,
});
const compileLink = (variant) => createAjv().compile(deriveVariant(linkSource(), variant));

test('link helper: permid required, label and href read-only, nothing else allowed', () => {
  const schema = link({ target: 'references', label: 'title' });
  assert.deepEqual(schema.required, ['permid']);
  assert.equal(schema.properties.title.readOnly, true);
  assert.equal(schema.properties.href.readOnly, true);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema['x-link'], { target: 'references', label: 'title' });
  const out = compileLink('out');
  assert.equal(out({ reference: { permid: 'p', title: 't', href: '/r/p' } }), true, JSON.stringify(out.errors));
  assert.equal(out({ reference: { permid: 'p' } }), true, 'the label may be absent');
  assert.equal(out({ reference: { permid: 'p', authors: [] } }), false);
});

test('in-create rejects a link label, at its path', () => {
  const create = compileLink('in-create');
  assert.equal(create({ reference: { permid: 'p' } }), true, JSON.stringify(create.errors));
  assert.equal(create({ reference: { permid: 'p', title: 'x' } }), false);
  assert.ok(create.errors.some((e) => e.instancePath === '/reference' && e.params?.additionalProperty === 'title'));
  assert.equal(create({ reference: {} }), false);
  assert.equal(create({ reference: 'p' }), false);
});

test('out alone allows a null link', () => {
  assert.equal(compileLink('out')({ reference: null }), true);
  assert.equal(compileLink('in-create')({ reference: null }), false);
});

test('patch-guard names root readOnly keys only', () => {
  const s = linkSource();
  s.properties.permid = { type: 'string', readOnly: true };
  assert.deepEqual(deriveVariant(s, 'patch-guard').propertyNames, { not: { enum: ['permid'] } });
});

test('ids and root strictness per variant', () => {
  for (const v of ['db', 'in-create', 'out']) {
    const d = deriveVariant(resolved(), v);
    assert.equal(d.$id, `https://pbdb2.example.com/schemas/thing.${v}.json`);
    assert.equal(d.unevaluatedProperties, false);
  }
});

test('db: x-storage removed and pruned from required; readOnly-only kept; x-create dropped', () => {
  const d = deriveVariant(resolved(), 'db');
  assert.deepEqual(Object.keys(d.properties), ['legacyIDs', 'name', 'kind', 'unit', 'place']);
  assert.deepEqual(Object.keys(d.properties.place.properties), ['basis']);
  assert.deepEqual(d.required, ['name']);
  assert.deepEqual(d.properties.place.required, ['basis']);
  assert.equal(JSON.stringify(d).includes('x-create'), false);
  const validate = compile('db');
  assert.equal(validate({ name: 'n', legacyIDs: { oldpbdbID: '1' }, place: { basis: 'x' } }), true);
  assert.equal(validate({ name: 'n', permid: 'p' }), false);
  assert.equal(validate({ name: 'n', kind: 'zzz' }), false);
});

test('in-create: readOnly removed and rejected; x-create merged', () => {
  const d = deriveVariant(resolved(), 'in-create');
  assert.equal('permid' in d.properties, false);
  assert.equal('legacyIDs' in d.properties, false);
  assert.deepEqual(d.required, ['name']);
  const validate = compile('in-create');
  const ok = { name: 'n', place: { basis: 'x', lat: 1, lng: 2 } };
  assert.equal(validate(ok), true);
  assert.equal(validate({ ...ok, legacyIDs: {} }), false);
  assert.equal(validate({ name: 'n' }), false, 'root x-create requires place');
  assert.equal(validate({ name: 'n', place: { basis: 'x', lat: 1 } }), false, 'nested x-create requires lng');
});

test('out: everything kept, dictionary enums not enforced, inline enums kept', () => {
  const d = deriveVariant(resolved(), 'out');
  assert.ok(d.properties.permid && d.properties.place.properties.lat);
  assert.equal('enum' in d.properties.kind, false);
  assert.deepEqual(d.properties.kind['x-enumFrom'], { table: 'kinds', column: 'name' });
  assert.deepEqual(d.properties.unit.enum, ['meters', 'feet']);
  assert.deepEqual(d.required, ['name', 'permid']);
  assert.equal(compile('out')({ name: 'n', permid: 'p', kind: 'removed later', place: { basis: 'x', lat: 1 } }), true);
});

test('patch-guard: object without readOnly keys', () => {
  const validate = compile('patch-guard');
  assert.equal(validate({ place: { lat: 1, lng: 2 }, name: null }), true);
  assert.equal(validate({ legacyIDs: { oldpbdbID: '1' } }), false);
  assert.equal(validate({ permid: 'x' }), false);
  assert.equal(validate([]), false);
  assert.equal(validate('x'), false);
});

test('patch-guard omits propertyNames without readOnly properties', () => {
  const s = source();
  delete s.properties.permid;
  delete s.properties.legacyIDs;
  s.required = ['name'];
  const g = deriveVariant(s, 'patch-guard');
  assert.equal('propertyNames' in g, false);
  assert.equal(g.type, 'object');
});
