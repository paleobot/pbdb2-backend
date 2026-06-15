import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { makeReadRepository } from '../../src/lib/repository.js';
import { readSchemaTree } from '../../src/lib/schema-tree.js';
import { setupTestDb, seedPerson, insertRef } from './helpers.js';

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
