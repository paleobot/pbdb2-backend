import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { setupTestDb, seedPerson } from './helpers.js';

/**
 * The permid format, registry and minting functions in db/02-core.sql
 * (openspec/specs/prefixed-permids). They are the only implementation of the
 * check digits, so they are tested here, in SQL, against the spec's examples.
 * One ephemeral database for the file; each test uses numbers no other test does.
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

const one = async (sql, params = []) => (await ctx.pool.query(sql, params)).rows[0];
const valid = async (value, prefix) => (await one('SELECT permid_is_valid($1, $2) AS ok', [value, prefix])).ok;
const rejects = (sql, params, pattern) => assert.rejects(ctx.pool.query(sql, params), pattern);
const registered = async (permids) =>
  Number((await one('SELECT count(*) AS n FROM permids WHERE permid = ANY ($1)', [permids])).n);

test('check digits follow MOD 97-10 over the whole ID', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);
  assert.equal((await one(`SELECT format_permid('COL', 12345) AS p`)).p, 'COL-12345-70');
  assert.equal((await one(`SELECT format_permid('REF', 12345) AS p`)).p, 'REF-12345-15');
  assert.equal(await valid('COL-12345-70', 'COL'), true);
  assert.equal(await valid('REF-12345-15', 'REF'), true);
});

test('a permid with the wrong prefix, swapped digits or a leading zero is not valid', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);
  assert.equal(await valid('REF-12345-70', 'REF'), false, 'COL check digits under REF');
  assert.equal(await valid('COL-12354-70', 'COL'), false, 'transposition');
  assert.equal(await valid('COL-012345-70', 'COL'), false, 'leading zero');
  assert.equal(await valid('COL-12345-70', 'REF'), false, 'another prefix');
});

test('a permid column rejects a leading zero and bad check digits', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);
  const insertRef = `INSERT INTO refs (permid, authorizer_person_id, enterer_person_id, reference)
                     VALUES ($1, $2, $2, '{}')`;
  await rejects(insertRef, ['REF-012345-15', personId], /check constraint/);
  await rejects(insertRef, ['REF-12345-16', personId], /check constraint/);
});

test('unknown and reserved prefixes are refused', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);
  const before = Number((await one('SELECT count(*) AS n FROM permids')).n);
  await rejects(`SELECT mint_permids('XYZ', 1)`, [], /unknown permid prefix XYZ/);
  await rejects(`SELECT mint_permids('TXL', 1)`, [], /reserved/);
  await rejects(`SELECT register_permids('TXC', ARRAY[1]::bigint[])`, [], /reserved/);
  await rejects(`SELECT format_permid('XYZ', 1)`, [], /unknown permid prefix/);
  await rejects(`SELECT permid_is_valid('TXL-1-00', 'TXL')`, [], /reserved/);
  assert.equal(Number((await one('SELECT count(*) AS n FROM permids')).n), before, 'nothing registered');
});

test('register_permids formats and registers legacy numbers in input order', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);
  const { permids } = await one(`SELECT register_permids('REF', ARRAY[12345, 96229]::bigint[]) AS permids`);
  assert.deepEqual(permids, ['REF-12345-15', 'REF-96229-78']);
  assert.equal(await registered(permids), 2);
});

test('register_permids refuses the floor, zero, repeats and registered permids, all or nothing', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);
  await rejects(`SELECT register_permids('COL', ARRAY[1000000]::bigint[])`, [], /between 1 and 999999/);
  await rejects(`SELECT register_permids('COL', ARRAY[0]::bigint[])`, [], /between 1 and 999999/);
  await rejects(`SELECT register_permids('COL', ARRAY[71, 71]::bigint[])`, [], /more than once/);

  await one(`SELECT register_permids('AUT', ARRAY[526271]::bigint[])`);
  await rejects(`SELECT register_permids('AUT', ARRAY[72, 526271]::bigint[])`, [], /AUT-526271-06 is already registered/);
  assert.equal(await registered([(await one(`SELECT format_permid('AUT', 72) AS p`)).p]), 0, 'AUT-72 rolled back');
});

test('the first mint for a prefix is the floor', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);
  const { permids } = await one(`SELECT mint_permids('SCH', 1) AS permids`);
  assert.deepEqual(permids, ['SCH-1000000-26']);
  assert.equal(await registered(permids), 1);
});

test('mint_permids mints a batch in one call, registered and in numeric order', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);
  const { permids } = await one(`SELECT mint_permids('AOP', 5000) AS permids`);
  assert.equal(permids.length, 5000);
  assert.equal(new Set(permids).size, 5000);
  const numbers = permids.map((p) => Number(p.split('-')[1]));
  assert.ok(numbers.every((n, i) => n >= 1_000_000 && (i === 0 || n === numbers[i - 1] + 1)));
  assert.equal(await registered(permids), 5000);
});

test('a permid column must name a registered permid', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);
  // Well-formed, never registered.
  const { p } = await one(`SELECT format_permid('REF', 4242) AS p`);
  await rejects(
    `INSERT INTO refs (permid, authorizer_person_id, enterer_person_id, reference) VALUES ($1, $2, $2, '{}')`,
    [p, personId],
    /foreign key/,
  );
});

test('a reference column checks its own prefix', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);
  const { permids: [ref] } = await one(`SELECT mint_permids('REF', 1) AS permids`);
  const { id: refId } = await one(
    `INSERT INTO refs (permid, authorizer_person_id, enterer_person_id, reference) VALUES ($1, $2, $2, '{}') RETURNING id`,
    [ref, personId],
  );
  const { permids: [aop, aut] } = await one(`SELECT mint_permids('AOP', 1) || mint_permids('AUT', 1) AS permids`);
  await rejects(
    `INSERT INTO assignment_opinions (permid, authorizer_person_id, enterer_person_id, subject_permid, reference_id, evidence)
     VALUES ($1, $2, $2, $3, $4, true)`,
    [aop, personId, aut, refId],
    /check constraint/,
  );
});

test('versions share a permid; a second head with one number is refused at commit', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);
  const { permids: [ref] } = await one(`SELECT mint_permids('REF', 1) AS permids`);
  const insert = `INSERT INTO refs (permid, authorizer_person_id, enterer_person_id, reference) VALUES ($1, $2, $2, '{}')`;
  for (let i = 0; i < 3; i += 1) await ctx.pool.query(insert, [ref, personId]);

  const { heads, versions } = await one(
    `SELECT count(*) FILTER (WHERE succeeded_by_id IS NULL) AS heads, count(*) AS versions FROM refs WHERE permid = $1`,
    [ref],
  );
  assert.deepEqual([Number(heads), Number(versions)], [1, 3]);
  assert.equal(await registered([ref]), 1, 'one registry row per entity, not per version');

  // Reopen the old head beside the current one: rejected when the transaction commits.
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE refs SET succeeded_by_id = NULL WHERE permid = $1 AND preceded_by_id IS NULL`,
      [ref],
    );
    await assert.rejects(client.query('COMMIT'), /refs_one_head_per_number/);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
});

test('a registered permid cannot be registered again', async (t) => {
  if (!ctx.available) return t.skip(ctx.reason);
  const { permids: [p] } = await one(`SELECT mint_permids('COL', 1) AS permids`);
  await rejects('INSERT INTO permids (permid) VALUES ($1)', [p], /duplicate key/);
});
