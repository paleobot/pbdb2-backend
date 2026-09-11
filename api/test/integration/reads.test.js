import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { makeReadRepository } from '../../src/lib/repository.js';
import { readSchemaTree } from '../../src/lib/schema-tree.js';
import { descriptorFor } from '../../src/lib/resource-tables.js';
import {
  setupTestDb,
  seedPerson,
  newPermid,
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
 * permids via `newPermid()` so assertions are independent. Skips cleanly when no
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

const refsRepo = () =>
  makeReadRepository({ pg: ctx.pool, table: 'refs', jsonbColumn: 'reference' });

// Enrichment repos use the production descriptors (table, jsonbColumn, references).
const authoritiesRepo = () => makeReadRepository({ pg: ctx.pool, ...descriptorFor('authorities') });
const collectionsRepo = () => makeReadRepository({ pg: ctx.pool, ...descriptorFor('collections') });

test('readHead returns the current head and excludes superseded versions', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);

  const permid = newPermid();
  await insertRef(ctx.pool, { permid, personId, reference: { title: 'v1' } });
  await insertRef(ctx.pool, { permid, personId, reference: { title: 'v2' } }); // triggers → head

  const head = await refsRepo().readHead(permid);
  assert.equal(head.permid, permid);
  assert.equal(head.title, 'v2', 'returns the latest version, not the superseded one');
});

test('readHead excludes a soft-removed head', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);

  const permid = newPermid();
  await insertRef(ctx.pool, { permid, personId, reference: { title: 'gone' }, removed: true });

  assert.equal(await refsRepo().readHead(permid), null);
});

test('readHead returns null for an unknown permid', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);
  assert.equal(await refsRepo().readHead(newPermid()), null);
});

test('list returns one record per non-removed lineage head', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);

  const live1 = newPermid();
  const live2 = newPermid();
  const removed = newPermid();
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

  const schemaPermid = newPermid();
  const charPermid = newPermid();
  const statePermid = newPermid();

  const ref = await insertRef(ctx.pool, {
    permid: newPermid(),
    personId,
    reference: { title: 'Backing ref' },
  });

  const { rows: [schema] } = await ctx.pool.query(
    `INSERT INTO schemas (permid, authorizer_person_id, enterer_person_id, schema, reference_id)
     VALUES ($1, $2, $2, $3::jsonb, $4) RETURNING id`,
    [schemaPermid, personId, JSON.stringify({ title: 'Leaf architecture' }), ref.id],
  );

  const { rows: [char] } = await ctx.pool.query(
    `INSERT INTO characters (permid, authorizer_person_id, enterer_person_id, parent_schema_id, character, sort_order)
     VALUES ($1, $2, $2, $3, $4::jsonb, $5) RETURNING id`,
    [charPermid, personId, schema.id, JSON.stringify({ name: 'Margin' }), 1],
  );

  await ctx.pool.query(
    `INSERT INTO states (permid, authorizer_person_id, enterer_person_id, parent_character_id, state, sort_order)
     VALUES ($1, $2, $2, $3, $4::jsonb, $5)`,
    [statePermid, personId, char.id, JSON.stringify({ name: 'Entire' }), 1],
  );

  const tree = await readSchemaTree(ctx.pool, schemaPermid);
  assert.equal(tree.permid, schemaPermid);
  assert.equal(tree.title, 'Leaf architecture');
  assert.equal(tree.characters.length, 1);
  assert.equal(tree.characters[0].permid, charPermid);
  assert.equal(tree.characters[0].name, 'Margin');
  assert.equal(tree.characters[0].states[0].permid, statePermid);
  assert.equal(tree.characters[0].states[0].name, 'Entire');

  // No internal serial id leaked into the tree.
  assert.ok(!('id' in tree.characters[0]));
});

test('schema tree returns null for an unknown permid', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);
  assert.equal(await readSchemaTree(ctx.pool, newPermid()), null);
});

// --- Reference enrichment -------------------------------------------------
// The repository emits pure { title, permid } reference objects; the `href` is
// hydrated separately at the route boundary (covered in repository.test.js).

test('authority read embeds its single reference', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);

  const refPermid = newPermid();
  const authorityPermid = newPermid();

  const ref = await insertRef(ctx.pool, {
    permid: refPermid,
    personId,
    reference: { title: 'Cited work' },
  });
  await insertAuthority(ctx.pool, {
    permid: authorityPermid,
    personId,
    authority: { taxonName: 'Calymene' },
    referenceId: ref.id,
  });

  const head = await authoritiesRepo().readHead(authorityPermid);
  assert.deepEqual(head.reference, { title: 'Cited work', permid: refPermid });
});

test('collection read embeds primary and additional references', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);

  const primaryPermid = newPermid();
  const add1Permid = newPermid();
  const add2Permid = newPermid();
  const collectionPermid = newPermid();

  const primary = await insertRef(ctx.pool, { permid: primaryPermid, personId, reference: { title: 'Primary' } });
  const add1 = await insertRef(ctx.pool, { permid: add1Permid, personId, reference: { title: 'Add 1' } });
  const add2 = await insertRef(ctx.pool, { permid: add2Permid, personId, reference: { title: 'Add 2' } });
  const col = await insertCollection(ctx.pool, {
    permid: collectionPermid,
    personId,
    collection: { name: 'Quarry A' },
    referenceId: primary.id,
  });
  await insertAdditionalCollectionRef(ctx.pool, { collectionId: col.id, referenceId: add1.id, personId });
  await insertAdditionalCollectionRef(ctx.pool, { collectionId: col.id, referenceId: add2.id, personId });

  const head = await collectionsRepo().readHead(collectionPermid);
  assert.deepEqual(head.primaryReference, { title: 'Primary', permid: primaryPermid });
  const titles = head.additionalReferences.map((r) => r.title).sort();
  assert.deepEqual(titles, ['Add 1', 'Add 2']);
  assert.deepEqual(
    head.additionalReferences.map((r) => r.permid).sort(),
    [add1Permid, add2Permid].sort(),
  );
});

test('collection with no additional references yields an empty array', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);

  const collectionPermid = newPermid();

  const primary = await insertRef(ctx.pool, { permid: newPermid(), personId, reference: { title: 'Only primary' } });
  await insertCollection(ctx.pool, {
    permid: collectionPermid,
    personId,
    referenceId: primary.id,
  });

  const head = await collectionsRepo().readHead(collectionPermid);
  assert.deepEqual(head.additionalReferences, []);
});

test('schema tree embeds primary and additional references', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);

  const primaryPermid = newPermid();
  const add1Permid = newPermid();
  const schemaPermid = newPermid();

  const primary = await insertRef(ctx.pool, { permid: primaryPermid, personId, reference: { title: 'Schema primary' } });
  const add1 = await insertRef(ctx.pool, { permid: add1Permid, personId, reference: { title: 'Schema add 1' } });
  const schema = await insertSchema(ctx.pool, {
    permid: schemaPermid,
    personId,
    schema: { title: 'Leaf architecture' },
    referenceId: primary.id,
  });
  await insertAdditionalSchemaRef(ctx.pool, { schemaId: schema.id, referenceId: add1.id, personId });

  const tree = await readSchemaTree(ctx.pool, schemaPermid);
  assert.deepEqual(tree.primaryReference, { title: 'Schema primary', permid: primaryPermid });
  assert.deepEqual(tree.additionalReferences, [{ title: 'Schema add 1', permid: add1Permid }]);
});

test('edited reference is reflected on re-read; permid is stable (FK swing tracks head)', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);

  const refPermid = newPermid();
  const authorityPermid = newPermid();

  const v1 = await insertRef(ctx.pool, { permid: refPermid, personId, reference: { title: 'v1' } });
  await insertAuthority(ctx.pool, { permid: authorityPermid, personId, referenceId: v1.id });

  // A new version of the reference: the swing trigger moves authority.reference_id
  // from v1 to the new head, so a plain join now yields the new title.
  await insertRef(ctx.pool, { permid: refPermid, personId, reference: { title: 'v2' } });

  const head = await authoritiesRepo().readHead(authorityPermid);
  assert.deepEqual(head.reference, { title: 'v2', permid: refPermid });
});

test('edited collection retains its additional references (join FK swung to new head)', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);

  const addPermid = newPermid();
  const collectionPermid = newPermid();

  const primary = await insertRef(ctx.pool, { permid: newPermid(), personId, reference: { title: 'P' } });
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
  assert.equal(head.name, 'v2', 'reads the new head');
  assert.deepEqual(head.additionalReferences, [{ title: 'A', permid: addPermid }]);
});

test('removed primary reference resolves to null', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);

  const authorityPermid = newPermid();

  const ref = await insertRef(ctx.pool, {
    permid: newPermid(),
    personId,
    reference: { title: 'Gone' },
    removed: true,
  });
  await insertAuthority(ctx.pool, { permid: authorityPermid, personId, referenceId: ref.id });

  const head = await authoritiesRepo().readHead(authorityPermid);
  assert.equal(head.reference, null);
});

test('removed additional references are omitted from the array', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);

  const livePermid = newPermid();
  const collectionPermid = newPermid();

  const primary = await insertRef(ctx.pool, { permid: newPermid(), personId, reference: { title: 'P' } });
  const live = await insertRef(ctx.pool, { permid: livePermid, personId, reference: { title: 'Live' } });
  const gone = await insertRef(ctx.pool, { permid: newPermid(), personId, reference: { title: 'Gone' }, removed: true });
  const col = await insertCollection(ctx.pool, {
    permid: collectionPermid,
    personId,
    referenceId: primary.id,
  });
  await insertAdditionalCollectionRef(ctx.pool, { collectionId: col.id, referenceId: live.id, personId });
  await insertAdditionalCollectionRef(ctx.pool, { collectionId: col.id, referenceId: gone.id, personId });

  const head = await collectionsRepo().readHead(collectionPermid);
  assert.deepEqual(head.additionalReferences, [{ title: 'Live', permid: livePermid }]);
});

/**
 * Keyset pagination against real PostgreSQL. This matters beyond the unit tier
 * because `permid` is a UUID column: `permid > $1` and `ORDER BY permid` follow
 * PostgreSQL's uuid comparison, not the string comparison a JS fake uses, and
 * the parameter arrives as text to be cast. Paging has to agree with the
 * database's own ordering or pages silently skip or repeat rows.
 */
test('keyset pagination pages through real heads in the database\'s own order', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);

  const minted = [];
  for (let i = 0; i < 7; i += 1) {
    const permid = newPermid();
    minted.push(permid);
    await insertRef(ctx.pool, { permid, personId, reference: { title: `Page ${i}` } });
  }

  // The order the database itself reports is the contract paging must match.
  const { rows: ordered } = await ctx.pool.query(
    `SELECT permid FROM refs
     WHERE permid = ANY($1) AND succeeded_by_id IS NULL AND NOT COALESCE(removed, false)
     ORDER BY permid`,
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
