import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { build, DEFAULT_PUBLIC_BASE_URL as BASE } from '../../src/app.js';
import { makeReadRepository } from '../../src/lib/repository.js';
import { readSchemaCharacters } from '../../src/lib/schema-tree.js';
import { descriptorFor } from '../../src/lib/resource-tables.js';
import { assertPublished } from '../published.js';
import {
  setupTestDb,
  seedPerson,
  mintPermid,
  insertRef,
  insertAuthority,
  insertCollection,
  insertSchema,
  insertAdditionalCollectionRef,
  insertAdditionalSchemaRef,
} from './helpers.js';

/**
 * Integration tier: real PostgreSQL, real lineage triggers, real recursive CTE.
 * Provisions one ephemeral database for the file; each test mints its own
 * permids via `mintPermid()` so assertions are independent. Skips cleanly when no
 * database is reachable.
 */
let ctx = { available: false, reason: 'not initialized' };
let personId;

before(async () => {
  ctx = await setupTestDb();
  if (ctx.available) personId = await seedPerson(ctx.pool);
});

after(async () => {
  if (ctx.teardown) await ctx.teardown();
});

const refsRepo = () => makeReadRepository({ pg: ctx.pool, ...descriptorFor('references') });

// The response contracts (data-access, api-description): every read is checked
// against the schema the API publishes for it. A schema single read carries its
// characters tree, which the published `Schema` declares through the recursive
// `Character` and `State` components, so one validation covers every node.
const assertAuthorityContract = (record) => assertPublished('Authority', record);
const assertCollectionContract = (record) => assertPublished('Collection', record);
const assertReferenceContract = (record) => assertPublished('Reference', record);
const assertSchemaContract = (record) => assertPublished('Schema', record);
const without = (obj, keys) => Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));
const assertSchemaTreeContract = (data) => {
  assert.ok(Array.isArray(data.characters), 'a single read carries its characters');
  assertPublished('Schema', data);
};

// Enrichment repos use the production descriptors (table, jsonbColumn, references).
const authoritiesRepo = () => makeReadRepository({ pg: ctx.pool, ...descriptorFor('authorities') });
const collectionsRepo = () => makeReadRepository({ pg: ctx.pool, ...descriptorFor('collections') });
const schemasRepo = () => makeReadRepository({ pg: ctx.pool, ...descriptorFor('schemas') });

// Source-valid schema, character and state rows, as the PBot migration writes them.
const schemaPayload = (title) => ({ legacyIDs: { pbotID: `p-${title}` }, title, year: '2023' });
async function insertCharacter(pool, { permid, schemaId = null, characterId = null, character, sortOrder }) {
  const { rows: [row] } = await pool.query(
    `INSERT INTO characters (permid, authorizer_person_id, enterer_person_id, parent_schema_id, parent_character_id, character, sort_order)
     VALUES ($1, $2, $2, $3, $4, $5::jsonb, $6) RETURNING id, permid`,
    [permid ?? await mintPermid(pool, 'CHR'), personId, schemaId, characterId, JSON.stringify(character), sortOrder],
  );
  return row;
}
async function insertState(pool, { permid, characterId = null, stateId = null, state, quantitative = false, sortOrder }) {
  const { rows: [row] } = await pool.query(
    `INSERT INTO states (permid, authorizer_person_id, enterer_person_id, parent_character_id, parent_state_id, state, quantitative, sort_order)
     VALUES ($1, $2, $2, $3, $4, $5::jsonb, $6, $7) RETURNING id, permid`,
    [permid ?? await mintPermid(pool, 'STA'), personId, characterId, stateId, JSON.stringify(state), quantitative, sortOrder],
  );
  return row;
}

test('readHead returns the current head and excludes superseded versions', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);

  const permid = await mintPermid(ctx.pool, 'REF');
  await insertRef(ctx.pool, { permid, personId, reference: { title: 'v1' } });
  await insertRef(ctx.pool, { permid, personId, reference: { title: 'v2' } }); // triggers → head

  const head = await refsRepo().readHead(permid);
  assert.equal(head.permid, permid);
  assert.equal(head.title, 'v2', 'returns the latest version, not the superseded one');
});

test('readHead excludes a soft-removed head', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);

  const permid = await mintPermid(ctx.pool, 'REF');
  await insertRef(ctx.pool, { permid, personId, reference: { title: 'gone' }, removed: true });

  assert.equal(await refsRepo().readHead(permid), null);
});

test('readHead returns null for an unknown permid', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);
  assert.equal(await refsRepo().readHead(await mintPermid(ctx.pool, 'REF')), null);
});

test('list returns one record per non-removed lineage head', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);

  const live1 = await mintPermid(ctx.pool, 'REF');
  const live2 = await mintPermid(ctx.pool, 'REF');
  const removed = await mintPermid(ctx.pool, 'REF');
  await insertRef(ctx.pool, { permid: live1, personId, reference: { title: 'L1 v1' } });
  await insertRef(ctx.pool, { permid: live1, personId, reference: { title: 'L1 v2' } }); // 2 versions, 1 head
  await insertRef(ctx.pool, { permid: live2, personId, reference: { title: 'L2' } });
  await insertRef(ctx.pool, { permid: removed, personId, reference: { title: 'X' }, removed: true });

  const all = await refsRepo().list();
  const count = (p) => all.filter((r) => r.permid === p).length;

  assert.equal(count(live1), 1, 'a multi-version lineage appears once (its head)');
  assert.equal(count(live2), 1);
  assert.equal(count(removed), 0, 'removed lineages are excluded');
  // The live head reflects the latest version.
  assert.equal(all.find((r) => r.permid === live1).title, 'L1 v2');
});

test('schema read: merged head, a repeated primary, and a merged tree of current versions', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);

  const ref = await insertRef(ctx.pool, { permid: await mintPermid(ctx.pool, 'REF'), personId, reference: { title: 'Backing ref' } });
  const schema = await insertSchema(ctx.pool, {
    permid: await mintPermid(ctx.pool, 'SCH'), personId, schema: schemaPayload('Leaf architecture'), referenceId: ref.id,
  });
  // The one localhost child row repeats its schema's primary; so does this one.
  await insertAdditionalSchemaRef(ctx.pool, { schemaId: schema.id, referenceId: ref.id, personId });

  const leaf = await insertCharacter(ctx.pool, { schemaId: schema.id, character: { name: 'Leaf', definition: 'The lamina' }, sortOrder: 1 });
  const margin = await insertCharacter(ctx.pool, { characterId: leaf.id, character: { name: 'Margin' }, sortOrder: 1 });
  const length = await insertState(ctx.pool, { characterId: margin.id, state: { name: 'Length' }, quantitative: true, sortOrder: 2 });
  const toothed = await insertState(ctx.pool, { characterId: margin.id, state: { name: 'Toothed' }, sortOrder: 1 });
  const serrate = await insertState(ctx.pool, { stateId: toothed.id, state: { name: 'Serrate' }, sortOrder: 1 });
  // A superseded character version stays out of the tree.
  await insertCharacter(ctx.pool, { permid: margin.permid, characterId: leaf.id, character: { name: 'Margin v2' }, sortOrder: 1 });

  const app = build({ pg: ctx.pool });
  t.after(() => app.close());

  const { data } = (await app.inject({ method: 'GET', url: `/api/v1/schemas/${schema.permid}` })).json();
  assertSchemaTreeContract(data);
  const link = { title: 'Backing ref', permid: ref.permid, href: `${BASE}/api/v1/references/${ref.permid}` };
  assert.deepEqual(data.primaryReference, link);
  assert.deepEqual(data.additionalReferences, [link], 'the primary repeats as stored');

  assert.equal(data.characters.length, 1);
  const [leafNode] = data.characters;
  assert.deepEqual(without(leafNode, ['characters', 'states']), { permid: leaf.permid, name: 'Leaf', definition: 'The lamina' });
  const [marginNode] = leafNode.characters;
  assert.equal(marginNode.name, 'Margin v2', 'the current version of a re-versioned character');
  assert.equal(marginNode.permid, margin.permid);
  assert.deepEqual(marginNode.states.map((s) => [s.permid, s.quantitative]), [[toothed.permid, false], [length.permid, true]]);
  assert.deepEqual(marginNode.states[0].states, [{ permid: serrate.permid, name: 'Serrate', quantitative: false, states: [] }]);

  // The head is the list item, and the list honours the contract whole.
  const list = (await app.inject({ method: 'GET', url: `/api/v1/schemas?ids=${schema.permid}` })).json().data;
  assert.equal(list.length, 1);
  assertSchemaContract(list[0]);
  assert.deepEqual(without(data, ['characters']), list[0]);
  const page = (await app.inject({ method: 'GET', url: '/api/v1/schemas?limit=100' })).json().data;
  for (const item of page.filter((s) => s.permid === schema.permid)) assertSchemaContract(item);
});

test('schema read of an unknown permid is a 404, and it has no characters', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);
  const app = build({ pg: ctx.pool });
  t.after(() => app.close());
  const missing = await mintPermid(ctx.pool, 'SCH');
  assert.equal((await app.inject({ method: 'GET', url: `/api/v1/schemas/${missing}` })).statusCode, 404);
  assert.deepEqual(await readSchemaCharacters(ctx.pool, missing), []);
});

test('re-versioned schema keeps its tree and child rows (FKs swung to the new head)', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);

  const primary = await insertRef(ctx.pool, { permid: await mintPermid(ctx.pool, 'REF'), personId, reference: { title: 'P' } });
  const add = await insertRef(ctx.pool, { permid: await mintPermid(ctx.pool, 'REF'), personId, reference: {} });
  const v1 = await insertSchema(ctx.pool, { permid: await mintPermid(ctx.pool, 'SCH'), personId, schema: schemaPayload('v1'), referenceId: primary.id });
  await insertAdditionalSchemaRef(ctx.pool, { schemaId: v1.id, referenceId: add.id, personId });
  const char = await insertCharacter(ctx.pool, { schemaId: v1.id, character: { name: 'Margin' }, sortOrder: 1 });

  // New version: characters.parent_schema_id and additional_schema_refs.schema_id
  // are swung to the new head.
  await insertSchema(ctx.pool, { permid: v1.permid, personId, schema: schemaPayload('v2'), referenceId: primary.id });

  const app = build({ pg: ctx.pool });
  t.after(() => app.close());
  const { data } = (await app.inject({ method: 'GET', url: `/api/v1/schemas/${v1.permid}` })).json();
  assertSchemaTreeContract(data);
  assert.equal(data.title, 'v2', 'reads the new head');
  assert.deepEqual(data.additionalReferences, [{ permid: add.permid, href: `${BASE}/api/v1/references/${add.permid}` }], 'an untitled reference has no title key');
  assert.deepEqual(data.characters.map((c) => c.permid), [char.permid]);
});

// --- Reference enrichment -------------------------------------------------
// The repository emits pure { title, permid } reference objects; the `href` is
// hydrated separately at the route boundary (covered in repository.test.js).

test('authority read embeds its single reference', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);

  const refPermid = await mintPermid(ctx.pool, 'REF');
  const authorityPermid = await mintPermid(ctx.pool, 'AUT');

  const ref = await insertRef(ctx.pool, {
    permid: refPermid,
    personId,
    reference: { title: 'Cited work' },
  });
  await insertAuthority(ctx.pool, {
    permid: authorityPermid,
    personId,
    authority: { legacyIDs: { oldpbdbIDs: ['42'] }, citation: 'Barrande 1846', descriptors: ['Barrande'], year: '1846', publishedInReference: true },
    referenceId: ref.id,
  });

  // Read through merge(): the whole stored payload plus the reference link,
  // with no internal id.
  const head = await authoritiesRepo().readHead(authorityPermid);
  assertAuthorityContract(head);
  assert.deepEqual(head, {
    permid: authorityPermid,
    legacyIDs: { oldpbdbIDs: ['42'] },
    citation: 'Barrande 1846',
    descriptors: ['Barrande'],
    year: '1846',
    publishedInReference: true,
    reference: { title: 'Cited work', permid: refPermid },
  });
});

test('authority citing an untitled reference reads without a title key', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);

  const refPermid = await mintPermid(ctx.pool, 'REF');
  const authorityPermid = await mintPermid(ctx.pool, 'AUT');
  const ref = await insertRef(ctx.pool, { permid: refPermid, personId, reference: {} });
  await insertAuthority(ctx.pool, { permid: authorityPermid, personId, referenceId: ref.id });

  const head = await authoritiesRepo().readHead(authorityPermid);
  assertAuthorityContract(head);
  assert.deepEqual(head.reference, { permid: refPermid });
});

test('authority routes honour the out contract over real PostgreSQL, with hrefs', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);

  const titled = await insertRef(ctx.pool, { permid: await mintPermid(ctx.pool, 'REF'), personId, reference: { title: 'Route ref' } });
  const removed = await insertRef(ctx.pool, { permid: await mintPermid(ctx.pool, 'REF'), personId, reference: { title: 'Gone' }, removed: true });
  const live = await mintPermid(ctx.pool, 'AUT');
  const orphaned = await mintPermid(ctx.pool, 'AUT');
  await insertAuthority(ctx.pool, { permid: live, personId, referenceId: titled.id });
  await insertAuthority(ctx.pool, { permid: orphaned, personId, referenceId: removed.id });

  const app = build({ pg: ctx.pool });
  t.after(() => app.close());

  const single = (await app.inject({ method: 'GET', url: `/api/v1/authorities/${live}` })).json().data;
  assertAuthorityContract(single);
  assert.deepEqual(single.reference, { title: 'Route ref', permid: titled.permid, href: `${BASE}/api/v1/references/${titled.permid}` });

  const list = (await app.inject({ method: 'GET', url: `/api/v1/authorities?ids=${live},${orphaned}` })).json().data;
  for (const item of list) assertAuthorityContract(item);
  assert.equal(list.find((a) => a.permid === orphaned).reference, null);

  const page = (await app.inject({ method: 'GET', url: '/api/v1/authorities?limit=100' })).json().data;
  assert.ok(page.length >= 2);
  for (const item of page) assertAuthorityContract(item);
});

test('reference routes honour the out contract over real PostgreSQL', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);

  // Other tests insert placeholder refs ({} or { title }) that no reference
  // source would accept, so only the refs inserted here are checked.
  const titledPayload = {
    title: 'Trilobites from the Lower Mississippian',
    authors: [{ givenName: 'D. K.', familyName: 'Brezinski' }],
    legacyIDs: { oldpbdbID: '1' },
    journalTitle: 'Journal of Paleontology',
    publicationType: 'journal article',
    publicationYear: '1998',
  };
  const untitledPayload = {
    authors: [{ givenName: 'A. K.', familyName: 'Agadjanian' }],
    legacyIDs: { oldpbdbID: '923' },
    publicationType: 'journal article',
    publicationYear: '1999',
  };
  const titled = await insertRef(ctx.pool, { permid: await mintPermid(ctx.pool, 'REF'), personId, reference: titledPayload });
  const untitled = await insertRef(ctx.pool, { permid: await mintPermid(ctx.pool, 'REF'), personId, reference: untitledPayload });

  const app = build({ pg: ctx.pool });
  t.after(() => app.close());

  const single = (await app.inject({ method: 'GET', url: `/api/v1/references/${titled.permid}` })).json().data;
  assertReferenceContract(single);
  assert.deepEqual(single, { permid: titled.permid, ...titledPayload });

  const list = (await app.inject({ method: 'GET', url: `/api/v1/references?ids=${titled.permid},${untitled.permid}` })).json().data;
  assert.equal(list.length, 2);
  for (const item of list) assertReferenceContract(item);
  assert.deepEqual(list.find((r) => r.permid === untitled.permid), { permid: untitled.permid, ...untitledPayload });
});

test('collection read merges coordinates and embeds references, a repeated primary included', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);

  const primaryPermid = await mintPermid(ctx.pool, 'REF');
  const add1Permid = await mintPermid(ctx.pool, 'REF');
  const add2Permid = await mintPermid(ctx.pool, 'REF');
  const collectionPermid = await mintPermid(ctx.pool, 'COL');

  const primary = await insertRef(ctx.pool, { permid: primaryPermid, personId, reference: { title: 'Primary' } });
  const add1 = await insertRef(ctx.pool, { permid: add1Permid, personId, reference: { title: 'Add 1' } });
  const add2 = await insertRef(ctx.pool, { permid: add2Permid, personId, reference: {} });
  const col = await insertCollection(ctx.pool, {
    permid: collectionPermid,
    personId,
    collection: { name: 'Quarry A', location: { toponym: { administrativeArea: { admin0: 'US' } }, scale: 'outcrop' } },
    referenceId: primary.id,
    location: 'SRID=4326;POINT(-110.25 45.5)',
  });
  // As Classic's secondary_refs usually has it, the primary is also a child row.
  await insertAdditionalCollectionRef(ctx.pool, { collectionId: col.id, referenceId: primary.id, personId });
  await insertAdditionalCollectionRef(ctx.pool, { collectionId: col.id, referenceId: add1.id, personId });
  await insertAdditionalCollectionRef(ctx.pool, { collectionId: col.id, referenceId: add2.id, personId });

  const head = await collectionsRepo().readHead(collectionPermid);
  assertCollectionContract(head);
  assert.deepEqual(head.location.coordinates, { latitude: 45.5, longitude: -110.25 });
  assert.deepEqual(head.primaryReference, { title: 'Primary', permid: primaryPermid });
  assert.deepEqual(head.additionalReferences, [
    { title: 'Primary', permid: primaryPermid },
    { title: 'Add 1', permid: add1Permid },
    { permid: add2Permid },
  ], 'stored rows in id order; an untitled reference has no title key');
  for (const leaked of ['id', 'reference_id']) assert.equal(leaked in head, false);

  // The same collection through the route: hydrated links, and a list item that
  // honours the contract.
  const app = build({ pg: ctx.pool });
  t.after(() => app.close());
  const { data } = (await app.inject({ method: 'GET', url: `/api/v1/collections/${collectionPermid}` })).json();
  assertCollectionContract(data);
  assert.equal(data.primaryReference.href, `${BASE}/api/v1/references/${primaryPermid}`);
  assert.deepEqual(data.additionalReferences.map((r) => r.href), [primaryPermid, add1Permid, add2Permid].map((p) => `${BASE}/api/v1/references/${p}`));
  const list = (await app.inject({ method: 'GET', url: `/api/v1/collections?ids=${collectionPermid}` })).json().data;
  assert.equal(list.length, 1);
  assertCollectionContract(list[0]);
});

test('collection with no additional references yields an empty array', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);

  const collectionPermid = await mintPermid(ctx.pool, 'COL');

  const primary = await insertRef(ctx.pool, { permid: await mintPermid(ctx.pool, 'REF'), personId, reference: { title: 'Only primary' } });
  await insertCollection(ctx.pool, {
    permid: collectionPermid,
    personId,
    referenceId: primary.id,
  });

  const head = await collectionsRepo().readHead(collectionPermid);
  assertCollectionContract(head);
  assert.deepEqual(head.additionalReferences, []);
  assert.equal(head.location, undefined, 'no location column and none in the jsonb');
});

test('schema head embeds primary and additional references; removed ones are suppressed', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);

  const primaryPermid = await mintPermid(ctx.pool, 'REF');
  const add1Permid = await mintPermid(ctx.pool, 'REF');
  const primary = await insertRef(ctx.pool, { permid: primaryPermid, personId, reference: { title: 'Schema primary' } });
  const add1 = await insertRef(ctx.pool, { permid: add1Permid, personId, reference: { title: 'Schema add 1' } });
  const gone = await insertRef(ctx.pool, { permid: await mintPermid(ctx.pool, 'REF'), personId, reference: { title: 'Gone' }, removed: true });

  const live = await insertSchema(ctx.pool, { permid: await mintPermid(ctx.pool, 'SCH'), personId, schema: schemaPayload('Live'), referenceId: primary.id });
  await insertAdditionalSchemaRef(ctx.pool, { schemaId: live.id, referenceId: add1.id, personId });
  await insertAdditionalSchemaRef(ctx.pool, { schemaId: live.id, referenceId: gone.id, personId });
  const orphaned = await insertSchema(ctx.pool, { permid: await mintPermid(ctx.pool, 'SCH'), personId, schema: schemaPayload('Orphaned'), referenceId: gone.id });

  const head = await schemasRepo().readHead(live.permid);
  assertSchemaContract(head);
  assert.deepEqual(head.primaryReference, { title: 'Schema primary', permid: primaryPermid });
  assert.deepEqual(head.additionalReferences, [{ title: 'Schema add 1', permid: add1Permid }], 'a removed additional reference is omitted');
  for (const leaked of ['id', 'reference_id', 'references']) assert.equal(leaked in head, false);

  const removedPrimary = await schemasRepo().readHead(orphaned.permid);
  assertSchemaContract(removedPrimary);
  assert.equal(removedPrimary.primaryReference, null);
  assert.deepEqual(removedPrimary.additionalReferences, [], 'no child rows');
});

test('edited reference is reflected on re-read; permid is stable (FK swing tracks head)', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);

  const refPermid = await mintPermid(ctx.pool, 'REF');
  const authorityPermid = await mintPermid(ctx.pool, 'AUT');

  const v1 = await insertRef(ctx.pool, { permid: refPermid, personId, reference: { title: 'v1' } });
  await insertAuthority(ctx.pool, { permid: authorityPermid, personId, referenceId: v1.id });

  // A new version of the reference: the swing trigger moves authority.reference_id
  // from v1 to the new head, so a plain join now yields the new title.
  await insertRef(ctx.pool, { permid: refPermid, personId, reference: { title: 'v2' } });

  const head = await authoritiesRepo().readHead(authorityPermid);
  assertAuthorityContract(head);
  assert.deepEqual(head.reference, { title: 'v2', permid: refPermid });
});

test('edited collection retains its additional references (join FK swung to new head)', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);

  const addPermid = await mintPermid(ctx.pool, 'REF');
  const collectionPermid = await mintPermid(ctx.pool, 'COL');

  const primary = await insertRef(ctx.pool, { permid: await mintPermid(ctx.pool, 'REF'), personId, reference: { title: 'P' } });
  const add = await insertRef(ctx.pool, { permid: addPermid, personId, reference: { title: 'A' } });
  const v1 = await insertCollection(ctx.pool, {
    permid: collectionPermid,
    personId,
    collection: { name: 'v1' },
    referenceId: primary.id,
  });
  await insertAdditionalCollectionRef(ctx.pool, { collectionId: v1.id, referenceId: add.id, personId });

  // New version of the collection: additional_collection_refs.collection_id is
  // swung to the new head, so the additional ref survives the edit.
  await insertCollection(ctx.pool, {
    permid: collectionPermid,
    personId,
    collection: { name: 'v2' },
    referenceId: primary.id,
  });

  const head = await collectionsRepo().readHead(collectionPermid);
  assertCollectionContract(head);
  assert.equal(head.name, 'v2', 'reads the new head');
  assert.deepEqual(head.additionalReferences, [{ title: 'A', permid: addPermid }]);
});

test('removed primary reference resolves to null', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);

  const authorityPermid = await mintPermid(ctx.pool, 'AUT');

  const ref = await insertRef(ctx.pool, {
    permid: await mintPermid(ctx.pool, 'REF'),
    personId,
    reference: { title: 'Gone' },
    removed: true,
  });
  await insertAuthority(ctx.pool, { permid: authorityPermid, personId, referenceId: ref.id });

  const head = await authoritiesRepo().readHead(authorityPermid);
  assertAuthorityContract(head);
  assert.equal(head.reference, null);
});

test('removed additional references are omitted from the array', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);

  const livePermid = await mintPermid(ctx.pool, 'REF');
  const collectionPermid = await mintPermid(ctx.pool, 'COL');

  const primary = await insertRef(ctx.pool, { permid: await mintPermid(ctx.pool, 'REF'), personId, reference: { title: 'P' } });
  const live = await insertRef(ctx.pool, { permid: livePermid, personId, reference: { title: 'Live' } });
  const gone = await insertRef(ctx.pool, { permid: await mintPermid(ctx.pool, 'REF'), personId, reference: { title: 'Gone' }, removed: true });
  const col = await insertCollection(ctx.pool, {
    permid: collectionPermid,
    personId,
    referenceId: primary.id,
  });
  await insertAdditionalCollectionRef(ctx.pool, { collectionId: col.id, referenceId: live.id, personId });
  await insertAdditionalCollectionRef(ctx.pool, { collectionId: col.id, referenceId: gone.id, personId });

  const head = await collectionsRepo().readHead(collectionPermid);
  assertCollectionContract(head);
  assert.deepEqual(head.additionalReferences, [{ title: 'Live', permid: livePermid }]);
});

test('a collection whose primary reference is removed reads it as null', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);

  const collectionPermid = await mintPermid(ctx.pool, 'COL');
  const gone = await insertRef(ctx.pool, { permid: await mintPermid(ctx.pool, 'REF'), personId, reference: { title: 'Gone' }, removed: true });
  const col = await insertCollection(ctx.pool, { permid: collectionPermid, personId, referenceId: gone.id });
  await insertAdditionalCollectionRef(ctx.pool, { collectionId: col.id, referenceId: gone.id, personId });

  const head = await collectionsRepo().readHead(collectionPermid);
  assertCollectionContract(head);
  assert.equal(head.primaryReference, null);
  assert.deepEqual(head.additionalReferences, [], 'its repeat among the child rows is omitted too');
});

/**
 * Keyset pagination against real PostgreSQL. This matters beyond the unit tier
 * because the order is the generated `permid_no` column: `permid_no > $1` and
 * `ORDER BY permid_no` run in the database, with the cursor's number bound as
 * text to be cast. Paging has to agree with the database's own ordering or
 * pages silently skip or repeat rows.
 */
test('keyset pagination pages through real heads in the database\'s own order', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);

  const minted = [];
  for (let i = 0; i < 7; i += 1) {
    const permid = await mintPermid(ctx.pool, 'REF');
    minted.push(permid);
    await insertRef(ctx.pool, { permid, personId, reference: { title: `Page ${i}` } });
  }

  // The order the database itself reports is the contract paging must match.
  const { rows: ordered } = await ctx.pool.query(
    `SELECT permid FROM refs
     WHERE permid = ANY($1) AND succeeded_by_id IS NULL AND NOT COALESCE(removed, false)
     ORDER BY permid_no`,
    [minted],
  );
  const expected = ordered.map((r) => r.permid);
  assert.equal(expected.length, 7);

  // Walk forward in pages of 3, following the cursor the repository produces.
  const seen = [];
  let cursor;
  let hasMore = true;
  let pages = 0;
  while (hasMore) {
    const page = await refsRepo().readHeads({ ids: minted, page: { limit: 3, cursor } });
    seen.push(...page.records.map((r) => r.permid));
    hasMore = page.hasMore;
    cursor = { permid: page.records[page.records.length - 1].permid, direction: 'next' };
    pages += 1;
    assert.ok(pages <= 4, 'paging terminates');
  }

  assert.deepEqual(seen, expected, 'every head exactly once, in the database order');

  // And back: a reverse page returns the preceding records, ascending.
  const back = await refsRepo().readHeads({
    ids: minted,
    page: { limit: 3, cursor: { permid: expected[6], direction: 'prev' } },
  });
  assert.deepEqual(
    back.records.map((r) => r.permid),
    expected.slice(3, 6),
    'the reverse keyset returns the preceding page, re-reversed to ascending',
  );
  assert.equal(back.hasMore, true, 'and reports that more lie behind it');
});

test('lists order by the number in the permid, not its text, and page through every record once', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);

  // Legacy-numbered permids whose text order differs from their numeric order
  // (REF-100-… sorts before REF-99-… as text), inserted out of order.
  const numbers = [100, 9, 1000, 99, 10, 101, 8];
  const { rows: [{ permids }] } = await ctx.pool.query(
    'SELECT register_permids($1, $2::bigint[]) AS permids', ['REF', numbers],
  );
  for (const permid of permids) await insertRef(ctx.pool, { permid, personId, reference: { title: permid } });
  const byNumber = Object.fromEntries(numbers.map((n, i) => [n, permids[i]]));
  const expected = [8, 9, 10, 99, 100, 101, 1000].map((n) => byNumber[n]);

  const seen = [];
  let cursor;
  let hasMore = true;
  while (hasMore) {
    const page = await refsRepo().readHeads({ ids: permids, page: { limit: 2, cursor } });
    seen.push(...page.records.map((r) => r.permid));
    hasMore = page.hasMore;
    cursor = { permid: page.records.at(-1).permid, direction: 'next' };
    assert.ok(seen.length <= permids.length, 'paging terminates');
  }

  assert.deepEqual(seen, expected, 'numeric order, every record exactly once');
  assert.ok(seen.indexOf(byNumber[99]) < seen.indexOf(byNumber[100]), 'REF-99-… before REF-100-…');
});
