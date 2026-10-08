import { test } from 'node:test';
import assert from 'node:assert/strict';
import { split, merge, collectCodecSources, loadCodecContext, isDictionarySource, codecKeyColumns, codecKeySites, storageColumns, storageSelects } from '../lib/storage.js';
import { getCodec } from '../lib/codecs.js';
import { authoritySource } from '../authority.schema.js';
import { collectionSource } from '../collection.schema.js';
import { deriveVariant } from '../lib/variants.js';
import { createAjv } from '../lib/ajv.js';

const source = {
  $id: 'https://pbdb2.example.com/schemas/thing.json',
  type: 'object',
  properties: {
    permid: { type: 'string', readOnly: true, 'x-storage': { column: 'permid' } },
    name: { type: 'string' },
    location: {
      type: 'object',
      properties: {
        coordinates: {
          type: 'object',
          properties: {
            latitude: { type: 'number', 'x-storage': { column: 'location', codec: 'wgs84Point' } },
            longitude: { type: 'number', 'x-storage': { column: 'location', codec: 'wgs84Point' } },
            basis: { type: 'string' },
          },
        },
        scale: { type: 'string' },
      },
    },
    references: {
      type: 'array',
      items: { type: 'object', properties: { permid: { type: 'string' }, order: { type: 'string' } } },
      'x-storage': { table: 'additional_collection_refs', codec: 'referenceList' },
    },
  },
  required: ['name'],
  'x-create': { required: ['references'] },
  unevaluatedProperties: false,
};

// Reference permids stand in as short strings; ids are strings, as node-postgres
// returns a bigint. Built as a loaded context would be: from head rows only.
const refsContext = (heads) => new Map([['refs', {
  byKey: new Map(heads.map(([id, permid]) => [id, permid])),
  byValue: new Map(heads.map(([id, permid]) => [permid, id])),
}]]);
const refs = refsContext([['3', 'r-3'], ['7', 'r-7'], ['9', 'r-9'], ['12', 'r-12'], ['1', 'r-1'], ['2', 'r-2']]);

test('coordinates to EWKT text; empty coordinates object dropped', () => {
  const { jsonb, columns } = split(source, { name: 'n', location: { coordinates: { latitude: 45.5, longitude: -110.25 }, scale: 'outcrop' } });
  assert.equal(columns.location, 'SRID=4326;POINT(-110.25 45.5)');
  assert.deepEqual(jsonb, { name: 'n', location: { scale: 'outcrop' } });
});

test('coordinates with other fields keep the object', () => {
  const { jsonb } = split(source, { name: 'n', location: { coordinates: { latitude: 1, longitude: 2, basis: 'b' } } });
  assert.deepEqual(jsonb.location.coordinates, { basis: 'b' });
});

test('half a coordinate pair throws', () => {
  assert.throws(() => split(source, { name: 'n', location: { coordinates: { latitude: 1 } } }), /together/);
});

test('primary reference goes to the column, the rest to child rows', () => {
  const { columns, children, jsonb } = split(source, {
    name: 'n',
    references: [{ permid: 'r-12', order: '2' }, { permid: 'r-7', order: '1' }],
  }, refs);
  assert.equal(columns.reference_id, '7');
  assert.deepEqual(children.additional_collection_refs, [{ reference_id: '12' }]);
  assert.equal('references' in jsonb, false);
});

test('reference order normalized on round trip', () => {
  const parts = split(source, { name: 'n', references: [{ permid: 'r-3', order: '1' }, { permid: 'r-9', order: '5' }] }, refs);
  parts.children.additional_collection_refs = parts.children.additional_collection_refs.map((r, i) => ({ id: String(100 + i), ...r }));
  assert.deepEqual(merge(source, parts, refs).references, [{ permid: 'r-3', order: '1' }, { permid: 'r-9', order: '2' }]);
});

test('merge rebuilds coordinates from GeoJSON, creating missing objects', () => {
  const merged = merge(source, {
    jsonb: { name: 'n' },
    columns: { location: { type: 'Point', coordinates: [-110.25, 45.5] }, permid: 'p', reference_id: '7' },
    children: { additional_collection_refs: [] },
  }, refs);
  assert.deepEqual(merged, {
    name: 'n',
    permid: 'p',
    location: { coordinates: { latitude: 45.5, longitude: -110.25 } },
    references: [{ permid: 'r-7', order: '1' }],
  });
});

test('null location merges to no coordinates', () => {
  assert.deepEqual(merge(source, { jsonb: { name: 'n' }, columns: { location: null } }), { name: 'n' });
});

test('unknown codec throws naming it', () => {
  const bad = { properties: { a: { type: 'string', 'x-storage': { column: 'a', codec: 'nope' } } } };
  assert.throws(() => split(bad, { a: 'x' }), /Unknown codec 'nope'/);
  assert.throws(() => merge(bad, { jsonb: {}, columns: { a: 'x' } }), /Unknown codec 'nope'/);
});

test('split of an in-create-valid payload yields db-valid jsonb', () => {
  const ajv = createAjv();
  const inCreate = ajv.compile(deriveVariant(source, 'in-create'));
  const db = ajv.compile(deriveVariant(source, 'db'));
  const payloads = [
    { name: 'a', references: [{ permid: 'r-1', order: '1' }] },
    { name: 'b', location: { coordinates: { latitude: 1, longitude: 2 } }, references: [{ permid: 'r-1', order: '1' }, { permid: 'r-2', order: '2' }] },
    { name: 'c', location: { coordinates: { latitude: 1, longitude: 2, basis: 'x' }, scale: 's' }, references: [] },
  ];
  for (const p of payloads) {
    assert.equal(inCreate(p), true, JSON.stringify(inCreate.errors));
    assert.equal(db(split(source, p, refs).jsonb), true, JSON.stringify(db.errors));
  }
});

test('referenceList merges stored ids to permids, and no refs.id reaches the payload', () => {
  const merged = merge(source, {
    jsonb: { name: 'n' },
    columns: { reference_id: '7' },
    children: { additional_collection_refs: [{ id: '501', reference_id: '12' }] },
  }, refs);
  assert.deepEqual(merged.references, [{ permid: 'r-7', order: '1' }, { permid: 'r-12', order: '2' }]);
});

test('referenceList throws naming itself on an unknown permid or id', () => {
  assert.throws(
    () => split(source, { name: 'n', references: [{ permid: 'r-nobody', order: '1' }] }, refs),
    /referenceList: refs.permid has no entry for "r-nobody"/,
  );
  assert.throws(
    () => merge(source, { jsonb: {}, columns: { reference_id: '7' }, children: { additional_collection_refs: [{ id: '1', reference_id: '404' }] } }, refs),
    /referenceList: refs.id has no entry for "404"/,
  );
  assert.throws(() => split(source, { name: 'n', references: [{ permid: 'r-7', order: '1' }] }), /referenceList: no codec context loaded for refs/);
});

test('referenceList writes child rows to the table its annotation names', () => {
  const schemaLike = {
    type: 'object',
    properties: {
      references: {
        type: 'array',
        items: { type: 'object', properties: { permid: { type: 'string' }, order: { type: 'string' } } },
        'x-storage': { table: 'additional_schema_refs', codec: 'referenceList' },
      },
    },
  };
  const { columns, children } = split(schemaLike, { references: [{ permid: 'r-9', order: '2' }, { permid: 'r-3', order: '1' }] }, refs);
  assert.equal(columns.reference_id, '3');
  assert.deepEqual(children, { additional_schema_refs: [{ reference_id: '9' }] });
});

test('the old codec name is gone', () => {
  const old = { type: 'object', properties: { references: { type: 'array', 'x-storage': { table: 't', codec: 'collectionReferences' } } } };
  assert.throws(() => split(old, { references: [] }, refs), /collectionReferences/);
  assert.throws(() => merge(old, { jsonb: {}, columns: {}, children: {} }, refs), /collectionReferences/);
});

test('a superseded reference is never cited: its permid resolves to the head', async () => {
  // Ref 7 was edited: version 7 is superseded by 20, and both carry permid r-7.
  // The succession filter is what the database applies; the fake honours it.
  const rows = [
    { k: '7', v: 'r-7', succeeded_by_id: '20' },
    { k: '20', v: 'r-7', succeeded_by_id: null },
    { k: '12', v: 'r-12', succeeded_by_id: null },
  ];
  const fakePg = {
    async query(sql) {
      const heads = sql.includes('succeeded_by_id IS NULL');
      return { rows: rows.filter((r) => !heads || r.succeeded_by_id === null) };
    },
  };
  const ctx = await loadCodecContext(fakePg, collectCodecSources(source));
  assert.equal(ctx.get('refs').byValue.get('r-7'), '20');
  assert.equal(ctx.get('refs').byKey.has('7'), false, 'the superseded row is in neither map');

  const { columns, children } = split(source, {
    name: 'n', references: [{ permid: 'r-7', order: '1' }, { permid: 'r-12', order: '2' }],
  }, ctx);
  assert.equal(columns.reference_id, '20');
  assert.deepEqual(children.additional_collection_refs, [{ reference_id: '12' }]);
  // A stored id naming a superseded row is a violated invariant, and says so.
  assert.throws(() => merge(source, { jsonb: {}, columns: { reference_id: '7' } }, ctx), /refs.id has no entry for "7"/);
});

// ---------- referencePermid (authority) ----------

// A refs context as loadCodecContext builds it for authority: titles as labels
// (ref 9 has none), and ref 12 a soft-removed head.
const labelledRefs = () => {
  const ctx = refsContext([['7', 'r-7'], ['9', 'r-9'], ['12', 'r-12']]);
  Object.assign(ctx.get('refs'), {
    labels: new Map([['7', { title: 'Fossil leaves' }], ['9', {}], ['12', { title: 'Gone' }]]),
    removed: new Set(['12']),
  });
  return ctx;
};

test('referencePermid merges the stored id to a link object, and no refs.id reaches the payload', () => {
  const merged = merge(authoritySource, { jsonb: { citation: 'c' }, columns: { permid: 'a-1', reference_id: '7' } }, labelledRefs());
  assert.deepEqual(merged.reference, { permid: 'r-7', title: 'Fossil leaves' });
  assert.equal(merged.permid, 'a-1');
  assert.equal(JSON.stringify(merged).includes('"7"'), false);
});

test('referencePermid: an untitled reference has no title key; a removed one merges to null', () => {
  const ctx = labelledRefs();
  assert.deepEqual(merge(authoritySource, { jsonb: {}, columns: { reference_id: '9' } }, ctx).reference, { permid: 'r-9' });
  assert.equal(merge(authoritySource, { jsonb: {}, columns: { reference_id: '12' } }, ctx).reference, null);
  // Without labels in the context the link still resolves, label-less.
  assert.deepEqual(merge(authoritySource, { jsonb: {}, columns: { reference_id: '7' } }, refs).reference, { permid: 'r-7' });
});

test('referencePermid split reads the permid only, and refuses a removed reference', () => {
  const ctx = labelledRefs();
  const { jsonb, columns } = split(authoritySource, { reference: { permid: 'r-7', title: 'Fossil leaves' }, citation: 'c' }, ctx);
  assert.deepEqual(columns, { reference_id: '7' });
  assert.deepEqual(jsonb, { citation: 'c' }, 'the label reaches neither the jsonb nor a column');
  assert.throws(() => split(authoritySource, { reference: { permid: 'r-12' } }, ctx), /referencePermid: reference "r-12" has been removed/);
});

test('referencePermid round trip: merge, drop root read-only keys, split', () => {
  const stored = { jsonb: { citation: 'c', publishedInReference: true }, columns: { permid: 'a-1', reference_id: '7' } };
  const { permid, ...writable } = merge(authoritySource, stored, labelledRefs());
  assert.deepEqual(split(authoritySource, writable, labelledRefs()).columns, { reference_id: '7' });
});

test('referencePermid resolves a superseded reference to its head', () => {
  // Built as a loaded context would be: ref 7 superseded by 20, heads only.
  const heads = refsContext([['20', 'r-7']]);
  assert.equal(split(authoritySource, { reference: { permid: 'r-7' } }, heads).columns.reference_id, '20');
  assert.throws(() => merge(authoritySource, { jsonb: {}, columns: { reference_id: '7' } }, heads), /referencePermid: refs.id has no entry for "7"/);
});

test('referencePermid: absent emits nothing; unknown permid throws naming the codec', () => {
  assert.deepEqual(split(authoritySource, { citation: 'c' }, refs).columns, {});
  assert.deepEqual(merge(authoritySource, { jsonb: {}, columns: { reference_id: null } }, refs), {});
  assert.throws(() => split(authoritySource, { reference: { permid: 'r-nobody' } }, refs), /referencePermid: refs.permid has no entry for "r-nobody"/);
});

test('codecKeyColumns maps refs to authorities.reference_id', () => {
  assert.deepEqual(codecKeyColumns(authoritySource), new Map([['refs', new Set(['reference_id'])]]));
});

// ---------- collection references: referencePermid + referenceLinks ----------

// Collection rows: ref 7 is the primary and also a child row, as Classic's
// secondary_refs usually has it; ref 9 is untitled; ref 12 is soft-removed.
const storedCollection = (childRefs, primary = '7') => ({
  jsonb: { name: 'c' },
  columns: { permid: 'c-1', reference_id: primary },
  children: { additional_collection_refs: childRefs.map(([id, ref]) => ({ id, reference_id: ref })) },
});

test('a single-property codec learns its property name; wgs84Point, serving two, does not', () => {
  // referencePermid emits under each source's own property name.
  const merged = merge(collectionSource, { ...storedCollection([]), columns: { reference_id: '7', location: { type: 'Point', coordinates: [2, 1] } } }, labelledRefs());
  assert.deepEqual(merged.primaryReference, { permid: 'r-7', title: 'Fossil leaves' });
  assert.equal('reference' in merged, false);
  assert.deepEqual(merge(authoritySource, { jsonb: {}, columns: { reference_id: '7' } }, labelledRefs()).reference, { permid: 'r-7', title: 'Fossil leaves' });
  // wgs84Point still names its own keys.
  assert.deepEqual(merged.location.coordinates, { latitude: 1, longitude: 2 });
});

test('referenceLinks merges child rows by id to labelled links, keeping a repeated primary', () => {
  const merged = merge(collectionSource, storedCollection([['31', '9'], ['30', '7']]), labelledRefs());
  assert.deepEqual(merged.primaryReference, { permid: 'r-7', title: 'Fossil leaves' });
  assert.deepEqual(merged.additionalReferences, [{ permid: 'r-7', title: 'Fossil leaves' }, { permid: 'r-9' }]);
  assert.equal(JSON.stringify(merged).includes('"30"'), false, 'no row or refs id reaches the payload');
});

test('referenceLinks omits a removed reference, and emits [] when nothing remains', () => {
  const ctx = labelledRefs();
  assert.deepEqual(merge(collectionSource, storedCollection([['30', '12'], ['31', '9']]), ctx).additionalReferences, [{ permid: 'r-9' }]);
  assert.deepEqual(merge(collectionSource, storedCollection([['30', '12']]), ctx).additionalReferences, []);
  assert.deepEqual(merge(collectionSource, storedCollection([]), ctx).additionalReferences, []);
  assert.deepEqual(merge(collectionSource, { jsonb: { name: 'c' }, columns: { reference_id: '7' } }, ctx).additionalReferences, [], 'no children given at all');
  // A removed primary reads as null, as on authority.
  assert.equal(merge(collectionSource, storedCollection([], '12'), ctx).primaryReference, null);
});

test('referenceLinks split reads permids only, in item order, and refuses a removed reference', () => {
  const ctx = labelledRefs();
  const { columns, children, jsonb } = split(collectionSource, {
    name: 'c',
    primaryReference: { permid: 'r-7', title: 'Fossil leaves' },
    additionalReferences: [{ permid: 'r-9', href: '/x' }, { permid: 'r-7', title: 'Fossil leaves' }],
  }, ctx);
  assert.deepEqual(columns, { reference_id: '7' });
  assert.deepEqual(children, { additional_collection_refs: [{ reference_id: '9' }, { reference_id: '7' }] });
  assert.deepEqual(jsonb, { name: 'c' });
  assert.deepEqual(split(collectionSource, { name: 'c', additionalReferences: [] }, ctx).children, { additional_collection_refs: [] });
  assert.deepEqual(split(collectionSource, { name: 'c' }, ctx).children, {}, 'absent emits nothing');
  assert.throws(() => split(collectionSource, { name: 'c', additionalReferences: [{ permid: 'r-12' }] }, ctx), /referenceLinks: reference "r-12" has been removed/);
  assert.throws(() => split(collectionSource, { name: 'c', additionalReferences: [{ permid: 'r-nobody' }] }, ctx), /referenceLinks: refs.permid has no entry for "r-nobody"/);
  assert.throws(() => merge(collectionSource, storedCollection([['30', '404']]), ctx), /referenceLinks: refs.id has no entry for "404"/);
});

test('collection round trip with a repeated primary: merge, drop root read-only keys, split', () => {
  const stored = storedCollection([['30', '7'], ['31', '9']]);
  const { permid, legacyIDs, ...writable } = merge(collectionSource, stored, labelledRefs());
  const parts = split(collectionSource, writable, labelledRefs());
  assert.equal(parts.columns.reference_id, '7');
  assert.deepEqual(parts.children.additional_collection_refs.map((r) => r.reference_id), ['7', '9']);
  assert.deepEqual(parts.jsonb, stored.jsonb);
});

test('collectCodecSources gives the collection one refs source, labelled, for both link fields', () => {
  assert.deepEqual(collectCodecSources(collectionSource), [
    { table: 'refs', key: 'id', value: 'permid', versioned: true, payload: 'reference', labels: ['title'] },
  ]);
});

test('codecKeyColumns leaves refs out for the collection, whose child rows also hold refs ids', () => {
  assert.equal(codecKeyColumns(collectionSource).has('refs'), false);
  assert.equal(codecKeyColumns(source).has('refs'), false, 'referenceList, as before');
  assert.deepEqual(codecKeyColumns(authoritySource), new Map([['refs', new Set(['reference_id'])]]));
});

test('codecKeySites lists the parent columns and child-row columns holding a source\'s keys', () => {
  assert.deepEqual(codecKeySites(collectionSource), new Map([
    ['refs', { columns: ['reference_id'], children: { additional_collection_refs: ['reference_id'] } }],
  ]));
  assert.deepEqual(codecKeySites(authoritySource), new Map([['refs', { columns: ['reference_id'], children: {} }]]));
});

test('storageSelects selects a column through its codec\'s expression', () => {
  assert.deepEqual(storageSelects(collectionSource), [
    { column: 'permid', expression: '"permid"' },
    { column: 'location', expression: 'ST_AsGeoJSON("location")::json' },
    { column: 'reference_id', expression: '"reference_id"' },
  ]);
  assert.deepEqual(storageSelects(authoritySource).map((s) => s.column).sort(), ['permid', 'reference_id']);
  assert.equal(getCodec('wgs84Point').select('location'), 'ST_AsGeoJSON("location")::json');
});

// ---------- Codec context ----------
// A source shaped like person's column-backed half. The codecs resolve against a
// hand-built Map: split and merge do no I/O, so no database is involved.

const personish = {
  $id: 'https://pbdb2.example.com/schemas/personish.json',
  type: 'object',
  properties: {
    permid: { type: 'string', readOnly: true, 'x-storage': { column: 'permid' } },
    familyName: { type: 'string' },
    role: {
      type: 'string',
      'x-enumFrom': { table: 'roles', column: 'name' },
      'x-storage': { column: 'role_id', codec: 'roleName' },
    },
    authorizer: { type: 'string', 'x-storage': { column: 'authorizer_person_id', codec: 'personPermid' } },
  },
  unevaluatedProperties: false,
};

const fixtureContext = new Map([
  ['dictionaries.roles', {
    byKey: new Map([[3, 'Authorizer'], [6, 'Person']]),
    byValue: new Map([['Authorizer', 3], ['Person', 6]]),
  }],
  ['persons', {
    byKey: new Map([[1106, 'p-1106']]),
    byValue: new Map([['p-1106', 1106]]),
  }],
]);

test('collectCodecSources unions what the codecs declare, once each', () => {
  assert.deepEqual(collectCodecSources(personish), [
    { table: 'dictionaries.roles', key: 'id', value: 'name' },
    { table: 'persons', key: 'id', value: 'permid' },
  ]);
  assert.deepEqual(collectCodecSources(source), [{ table: 'refs', key: 'id', value: 'permid', versioned: true, payload: 'reference' }]);
});

test('collectCodecSources asks a link\'s source for its label, merging labels across duplicates', () => {
  assert.deepEqual(collectCodecSources(authoritySource), [
    { table: 'refs', key: 'id', value: 'permid', versioned: true, payload: 'reference', labels: ['title'] },
  ]);
  const twoLinks = structuredClone(authoritySource);
  twoLinks.properties.reference = { ...twoLinks.properties.reference, 'x-link': { target: 'references', label: 'doi' } };
  twoLinks.properties.also = structuredClone(authoritySource.properties.reference);
  assert.deepEqual(collectCodecSources(twoLinks)[0].labels.sort(), ['doi', 'title']);
});

test('a source with labels must name its payload column, and its labels must be identifiers', async () => {
  const fakePg = { async query() { return { rows: [] }; } };
  await assert.rejects(() => loadCodecContext(fakePg, [{ table: 'refs', key: 'id', value: 'permid', labels: ['title'] }]), /must name its payload column/);
  await assert.rejects(() => loadCodecContext(fakePg, [{ table: 'refs', key: 'id', value: 'permid', payload: 'reference', labels: ["title'; --"] }]), /unsafe identifier/);
});

test('loadCodecContext reads labels and the removed set in the same query', async () => {
  const issued = [];
  const rows = [
    { k: '7', v: 'r-7', l0: 'Fossil leaves', removed: false },
    { k: '9', v: 'r-9', l0: null, removed: false },
    { k: '12', v: 'r-12', l0: 'Gone', removed: true },
  ];
  const fakePg = { async query(sql, params) { issued.push({ sql, params }); return { rows }; } };
  const ctx = await loadCodecContext(fakePg, collectCodecSources(authoritySource), { refs: { column: 'id', values: ['7', '9', '12'] } });
  assert.equal(issued.length, 1);
  assert.equal(
    issued[0].sql,
    `SELECT "id" AS k, "permid" AS v, "reference"->>'title' AS l0, COALESCE(removed, false) AS removed FROM "refs" WHERE succeeded_by_id IS NULL AND "id" = ANY($1)`,
  );
  const refsEntry = ctx.get('refs');
  assert.deepEqual(refsEntry.labels.get('7'), { title: 'Fossil leaves' });
  assert.deepEqual(refsEntry.labels.get('9'), {}, 'a NULL label is left out');
  assert.deepEqual([...refsEntry.removed], ['12']);
  assert.equal(refsEntry.byKey.get('12'), 'r-12', 'a removed head stays resolvable');
});

test('storageColumns lists the columns x-storage names, and no child tables', () => {
  assert.deepEqual(storageColumns(authoritySource).sort(), ['permid', 'reference_id']);
  assert.deepEqual(storageColumns(source).sort(), ['location', 'permid']);
});

test('collectCodecSources rejects an x-enumFrom that disagrees with the codec', () => {
  const bad = structuredClone(personish);
  bad.properties.role['x-enumFrom'] = { table: 'genders', column: 'name' };
  assert.throws(() => collectCodecSources(bad), /role: x-enumFrom names dictionaries.genders but codec 'roleName' reads dictionaries.roles/);
});

test('roleName and personPermid resolve both directions from a fixture map', () => {
  const { jsonb, columns } = split(
    personish,
    { familyName: 'f', role: 'Authorizer', authorizer: 'p-1106' },
    fixtureContext,
  );
  assert.deepEqual(jsonb, { familyName: 'f' });
  assert.equal(columns.role_id, 3);
  assert.equal(columns.authorizer_person_id, 1106);

  const merged = merge(
    personish,
    { jsonb: { familyName: 'f' }, columns: { role_id: 6, authorizer_person_id: 1106, permid: 'x' } },
    fixtureContext,
  );
  assert.deepEqual(merged, { familyName: 'f', permid: 'x', role: 'Person', authorizer: 'p-1106' });
});

test('an absent role or authorizer emits no column', () => {
  const { columns } = split(personish, { familyName: 'f' }, fixtureContext);
  assert.deepEqual(columns, {});
});

test('an unresolved value throws naming the codec and the value', () => {
  assert.throws(
    () => split(personish, { role: 'Curator' }, fixtureContext),
    /roleName: dictionaries.roles.name has no entry for "Curator"/,
  );
  assert.throws(
    () => split(personish, { authorizer: 'p-nobody' }, fixtureContext),
    /personPermid: persons.permid has no entry for "p-nobody"/,
  );
  assert.throws(
    () => merge(personish, { jsonb: {}, columns: { role_id: 99 } }, fixtureContext),
    /roleName: dictionaries.roles.id has no entry for 99/,
  );
});

test('no context at all throws rather than dropping the property', () => {
  assert.throws(() => split(personish, { role: 'Person' }), /roleName: no codec context loaded for dictionaries.roles/);
  assert.throws(
    () => merge(personish, { jsonb: {}, columns: { authorizer_person_id: 1106 } }),
    /personPermid: no codec context loaded for persons/,
  );
});

test('loadCodecContext reads dictionaries in full and restricts entity sources', async () => {
  const issued = [];
  const fakePg = {
    async query(sql, params) {
      issued.push({ sql, params });
      if (sql.includes('roles')) return { rows: [{ k: 3, v: 'Authorizer' }, { k: 6, v: 'Person' }] };
      return { rows: [{ k: 1106, v: 'p-1106' }] };
    },
  };
  const sources = collectCodecSources(personish);
  const ctx = await loadCodecContext(fakePg, sources, {
    'dictionaries.roles': { column: 'id', values: [3] },  // ignored: dictionaries are never batched
    persons: { column: 'id', values: [1106] },
  });
  assert.equal(issued[0].sql.includes('WHERE'), false, 'dictionary source read in full');
  assert.match(issued[1].sql, /FROM "persons" WHERE "id" = ANY\(\$1\)/);
  assert.deepEqual(issued[1].params, [[1106]]);
  // One read fills both directions.
  assert.equal(ctx.get('persons').byKey.get(1106), 'p-1106');
  assert.equal(ctx.get('persons').byValue.get('p-1106'), 1106);
  assert.equal(ctx.get('dictionaries.roles').byValue.get('Person'), 6);

  // The restriction may run in the value direction, which is what split needs.
  issued.length = 0;
  await loadCodecContext(fakePg, sources, { persons: { column: 'permid', values: ['p-1106'] } });
  assert.match(issued[1].sql, /WHERE "permid" = ANY\(\$1\)/);

  await assert.rejects(
    () => loadCodecContext(fakePg, sources, { persons: { column: 'person', values: [] } }),
    /can be restricted on id or permid, not person/,
  );
});

test('a reused context is not re-read, and each call returns a fresh Map', async () => {
  let reads = 0;
  const fakePg = { async query() { reads++; return { rows: [{ k: 6, v: 'Person' }] }; } };
  const sources = collectCodecSources(personish);
  const dicts = sources.filter(isDictionarySource);
  const entities = sources.filter((s) => !isDictionarySource(s));

  const runCtx = await loadCodecContext(fakePg, dicts);           // once for the run
  assert.equal(reads, 1);
  const batch1 = await loadCodecContext(fakePg, entities, { persons: { column: 'id', values: [6] } }, runCtx);
  const batch2 = await loadCodecContext(fakePg, entities, { persons: { column: 'id', values: [6] } }, runCtx);
  assert.equal(reads, 3, 'the dictionary was not re-read per batch');
  assert.ok(batch1.has('dictionaries.roles') && batch2.has('dictionaries.roles'));
  assert.notEqual(batch1, batch2);
  assert.equal(runCtx.has('persons'), false, 'a batch does not accumulate into the run context');
});

test('a versioned source is read from heads only, alone or with a selection', async () => {
  const issued = [];
  const fakePg = { async query(sql, params) { issued.push({ sql, params }); return { rows: [] }; } };
  const refsSource = { table: 'refs', key: 'id', value: 'permid', versioned: true };
  const personsSource = { table: 'persons', key: 'id', value: 'permid' };

  await loadCodecContext(fakePg, [refsSource, personsSource]);
  assert.equal(issued[0].sql, 'SELECT "id" AS k, "permid" AS v, COALESCE(removed, false) AS removed FROM "refs" WHERE succeeded_by_id IS NULL');
  assert.equal(issued[1].sql.includes('succeeded_by_id'), false, 'an unversioned source is not filtered');

  issued.length = 0;
  await loadCodecContext(fakePg, [refsSource], { refs: { column: 'permid', values: ['r-7'] } });
  assert.match(issued[0].sql, /WHERE succeeded_by_id IS NULL AND "permid" = ANY\(\$1\)$/);
  assert.deepEqual(issued[0].params, [['r-7']]);

  await assert.rejects(
    () => loadCodecContext(fakePg, [{ ...refsSource, versioned: 'yes' }]),
    /versioned flag, when given, must be true/,
  );
});
