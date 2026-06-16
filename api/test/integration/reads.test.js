import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { makeReadRepository } from '../../src/lib/repository.js';
import { readSchemaTree } from '../../src/lib/schema-tree.js';
import { descriptorFor } from '../../src/lib/resource-tables.js';
import {
  setupTestDb,
  seedPerson,
  insertRef,
  insertInterval,
  insertAuthority,
  insertCollection,
  insertSchema,
  insertAdditionalCollectionRef,
  insertAdditionalSchemaRef,
} from './helpers.js';

/**
 * Integration tier: real PostgreSQL, real lineage triggers, real recursive CTE.
 * Provisions one ephemeral database for the file; each test uses unique permids
 * so assertions are independent. Skips cleanly when no database is reachable.
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

const refsRepo = () =>
  makeReadRepository({ pg: ctx.pool, table: 'refs', jsonbColumn: 'reference' });

// Enrichment repos use the production descriptors (table, jsonbColumn, references).
const authoritiesRepo = () => makeReadRepository({ pg: ctx.pool, ...descriptorFor('authorities') });
const collectionsRepo = () => makeReadRepository({ pg: ctx.pool, ...descriptorFor('collections') });

test('readHead returns the current head and excludes superseded versions', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);

  const permid = 'ref-lineage-a';
  await insertRef(ctx.pool, { permid, personId, reference: { title: 'v1' } });
  await insertRef(ctx.pool, { permid, personId, reference: { title: 'v2' } }); // triggers → head

  const head = await refsRepo().readHead(permid);
  assert.equal(head.permid, permid);
  assert.equal(head.title, 'v2', 'returns the latest version, not the superseded one');
});

test('readHead excludes a soft-removed head', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);

  const permid = 'ref-removed-a';
  await insertRef(ctx.pool, { permid, personId, reference: { title: 'gone' }, removed: true });

  assert.equal(await refsRepo().readHead(permid), null);
});

test('readHead returns null for an unknown permid', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);
  assert.equal(await refsRepo().readHead('ref-nope'), null);
});

test('list returns one record per non-removed lineage head', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);

  const live1 = 'ref-list-live-1';
  const live2 = 'ref-list-live-2';
  const removed = 'ref-list-removed';
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

test('schema tree assembles current versions, keyed by permid', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);

  const ref = await insertRef(ctx.pool, {
    permid: 'ref-for-schema',
    personId,
    reference: { title: 'Backing ref' },
  });

  const { rows: [schema] } = await ctx.pool.query(
    `INSERT INTO schemas (permid, authorizer_person_id, enterer_person_id, schema, reference_id)
     VALUES ($1, $2, $2, $3::jsonb, $4) RETURNING id`,
    ['sch-int-1', personId, JSON.stringify({ title: 'Leaf architecture' }), ref.id],
  );

  const { rows: [char] } = await ctx.pool.query(
    `INSERT INTO characters (permid, authorizer_person_id, enterer_person_id, parent_schema_id, character, sort_order)
     VALUES ($1, $2, $2, $3, $4::jsonb, $5) RETURNING id`,
    ['chr-int-1', personId, schema.id, JSON.stringify({ name: 'Margin' }), 1],
  );

  await ctx.pool.query(
    `INSERT INTO states (permid, authorizer_person_id, enterer_person_id, parent_character_id, state, sort_order)
     VALUES ($1, $2, $2, $3, $4::jsonb, $5)`,
    ['stt-int-1', personId, char.id, JSON.stringify({ name: 'Entire' }), 1],
  );

  const tree = await readSchemaTree(ctx.pool, 'sch-int-1');
  assert.equal(tree.permid, 'sch-int-1');
  assert.equal(tree.title, 'Leaf architecture');
  assert.equal(tree.characters.length, 1);
  assert.equal(tree.characters[0].permid, 'chr-int-1');
  assert.equal(tree.characters[0].name, 'Margin');
  assert.equal(tree.characters[0].states[0].permid, 'stt-int-1');
  assert.equal(tree.characters[0].states[0].name, 'Entire');

  // No internal serial id leaked into the tree.
  assert.ok(!('id' in tree.characters[0]));
});

test('schema tree returns null for an unknown permid', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);
  assert.equal(await readSchemaTree(ctx.pool, 'sch-nope'), null);
});

// --- Reference enrichment -------------------------------------------------
// The repository emits pure { title, permid } reference objects; the `href` is
// hydrated separately at the route boundary (covered in repository.test.js).

test('authority read embeds its single reference', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);

  const ref = await insertRef(ctx.pool, {
    permid: 'ref-aut-enrich',
    personId,
    reference: { title: 'Cited work' },
  });
  await insertAuthority(ctx.pool, {
    permid: 'aut-enrich',
    personId,
    authority: { taxonName: 'Calymene' },
    referenceId: ref.id,
  });

  const head = await authoritiesRepo().readHead('aut-enrich');
  assert.deepEqual(head.reference, { title: 'Cited work', permid: 'ref-aut-enrich' });
});

test('collection read embeds primary and additional references', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);

  const primary = await insertRef(ctx.pool, { permid: 'ref-col-primary', personId, reference: { title: 'Primary' } });
  const add1 = await insertRef(ctx.pool, { permid: 'ref-col-add-1', personId, reference: { title: 'Add 1' } });
  const add2 = await insertRef(ctx.pool, { permid: 'ref-col-add-2', personId, reference: { title: 'Add 2' } });
  const interval = await insertInterval(ctx.pool, { permid: 'int-col', personId });
  const col = await insertCollection(ctx.pool, {
    permid: 'col-enrich',
    personId,
    collection: { name: 'Quarry A' },
    referenceId: primary.id,
    earlyAgeId: interval.id,
    lateAgeId: interval.id,
  });
  await insertAdditionalCollectionRef(ctx.pool, { collectionId: col.id, referenceId: add1.id, personId });
  await insertAdditionalCollectionRef(ctx.pool, { collectionId: col.id, referenceId: add2.id, personId });

  const head = await collectionsRepo().readHead('col-enrich');
  assert.deepEqual(head.primaryReference, { title: 'Primary', permid: 'ref-col-primary' });
  const titles = head.additionalReferences.map((r) => r.title).sort();
  assert.deepEqual(titles, ['Add 1', 'Add 2']);
  assert.deepEqual(head.additionalReferences.map((r) => r.permid).sort(), ['ref-col-add-1', 'ref-col-add-2']);
});

test('collection with no additional references yields an empty array', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);

  const primary = await insertRef(ctx.pool, { permid: 'ref-col-noadd', personId, reference: { title: 'Only primary' } });
  const interval = await insertInterval(ctx.pool, { permid: 'int-col-noadd', personId });
  await insertCollection(ctx.pool, {
    permid: 'col-noadd',
    personId,
    referenceId: primary.id,
    earlyAgeId: interval.id,
    lateAgeId: interval.id,
  });

  const head = await collectionsRepo().readHead('col-noadd');
  assert.deepEqual(head.additionalReferences, []);
});

test('schema tree embeds primary and additional references', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);

  const primary = await insertRef(ctx.pool, { permid: 'ref-sch-primary', personId, reference: { title: 'Schema primary' } });
  const add1 = await insertRef(ctx.pool, { permid: 'ref-sch-add-1', personId, reference: { title: 'Schema add 1' } });
  const schema = await insertSchema(ctx.pool, {
    permid: 'sch-enrich',
    personId,
    schema: { title: 'Leaf architecture' },
    referenceId: primary.id,
  });
  await insertAdditionalSchemaRef(ctx.pool, { schemaId: schema.id, referenceId: add1.id, personId });

  const tree = await readSchemaTree(ctx.pool, 'sch-enrich');
  assert.deepEqual(tree.primaryReference, { title: 'Schema primary', permid: 'ref-sch-primary' });
  assert.deepEqual(tree.additionalReferences, [{ title: 'Schema add 1', permid: 'ref-sch-add-1' }]);
});

test('edited reference is reflected on re-read; permid is stable (FK swing tracks head)', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);

  const v1 = await insertRef(ctx.pool, { permid: 'ref-swing', personId, reference: { title: 'v1' } });
  await insertAuthority(ctx.pool, { permid: 'aut-swing', personId, referenceId: v1.id });

  // A new version of the reference: the swing trigger moves authority.reference_id
  // from v1 to the new head, so a plain join now yields the new title.
  await insertRef(ctx.pool, { permid: 'ref-swing', personId, reference: { title: 'v2' } });

  const head = await authoritiesRepo().readHead('aut-swing');
  assert.deepEqual(head.reference, { title: 'v2', permid: 'ref-swing' });
});

test('edited collection retains its additional references (join FK swung to new head)', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);

  const primary = await insertRef(ctx.pool, { permid: 'ref-col-swing-p', personId, reference: { title: 'P' } });
  const add = await insertRef(ctx.pool, { permid: 'ref-col-swing-a', personId, reference: { title: 'A' } });
  const interval = await insertInterval(ctx.pool, { permid: 'int-col-swing', personId });
  const v1 = await insertCollection(ctx.pool, {
    permid: 'col-swing',
    personId,
    collection: { name: 'v1' },
    referenceId: primary.id,
    earlyAgeId: interval.id,
    lateAgeId: interval.id,
  });
  await insertAdditionalCollectionRef(ctx.pool, { collectionId: v1.id, referenceId: add.id, personId });

  // New version of the collection: additional_collection_refs.collection_id is
  // swung to the new head, so the additional ref survives the edit.
  await insertCollection(ctx.pool, {
    permid: 'col-swing',
    personId,
    collection: { name: 'v2' },
    referenceId: primary.id,
    earlyAgeId: interval.id,
    lateAgeId: interval.id,
  });

  const head = await collectionsRepo().readHead('col-swing');
  assert.equal(head.name, 'v2', 'reads the new head');
  assert.deepEqual(head.additionalReferences, [{ title: 'A', permid: 'ref-col-swing-a' }]);
});

test('removed primary reference resolves to null', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);

  const ref = await insertRef(ctx.pool, {
    permid: 'ref-removed-primary',
    personId,
    reference: { title: 'Gone' },
    removed: true,
  });
  await insertAuthority(ctx.pool, { permid: 'aut-removed-ref', personId, referenceId: ref.id });

  const head = await authoritiesRepo().readHead('aut-removed-ref');
  assert.equal(head.reference, null);
});

test('removed additional references are omitted from the array', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);

  const primary = await insertRef(ctx.pool, { permid: 'ref-col-sup-p', personId, reference: { title: 'P' } });
  const live = await insertRef(ctx.pool, { permid: 'ref-col-sup-live', personId, reference: { title: 'Live' } });
  const gone = await insertRef(ctx.pool, { permid: 'ref-col-sup-gone', personId, reference: { title: 'Gone' }, removed: true });
  const interval = await insertInterval(ctx.pool, { permid: 'int-col-sup', personId });
  const col = await insertCollection(ctx.pool, {
    permid: 'col-suppress',
    personId,
    referenceId: primary.id,
    earlyAgeId: interval.id,
    lateAgeId: interval.id,
  });
  await insertAdditionalCollectionRef(ctx.pool, { collectionId: col.id, referenceId: live.id, personId });
  await insertAdditionalCollectionRef(ctx.pool, { collectionId: col.id, referenceId: gone.id, personId });

  const head = await collectionsRepo().readHead('col-suppress');
  assert.deepEqual(head.additionalReferences, [{ title: 'Live', permid: 'ref-col-sup-live' }]);
});
