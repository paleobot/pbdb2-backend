import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveReference } from '../pbot-schemas-migration/migrate-pbot-schemas.js';

// Fake lookups standing in for the refs queries: one PBot-written row tagged by
// pbotID, one Classic row tagged by oldpbdbID. Each records what it was asked.
function fakes() {
  const calls = { byPbotID: [], byPbdbID: [] };
  return {
    calls,
    byPbotID: async (pbotID) => {
      calls.byPbotID.push(pbotID);
      return pbotID === 'ref-pbot' ? 11 : null;
    },
    byPbdbID: async (pbdbid) => {
      calls.byPbdbID.push(pbdbid);
      return pbdbid === '68934' ? { id: 22, title: 'Classic title' } : null;
    },
  };
}

test('resolves by pbotID', async () => {
  const f = fakes();
  const r = await resolveReference({ pbotID: 'ref-pbot', pbdbid: null }, f);
  assert.deepEqual(r, { id: 11, via: 'pbotID', classicTitle: null });
});

test('falls back to the trimmed pbdbid', async () => {
  const f = fakes();
  const r = await resolveReference({ pbotID: 'ref-classic', pbdbid: ' 68934 ' }, f);
  assert.deepEqual(r, { id: 22, via: 'pbdbid', classicTitle: 'Classic title' });
  assert.deepEqual(f.calls.byPbdbID, ['68934']);
});

test('pbotID takes precedence over pbdbid', async () => {
  const f = fakes();
  const r = await resolveReference({ pbotID: 'ref-pbot', pbdbid: '68934' }, f);
  assert.equal(r.via, 'pbotID');
  assert.equal(r.id, 11);
  assert.deepEqual(f.calls.byPbdbID, []);
});

test('a blank or null pbdbid is not looked up', async () => {
  for (const pbdbid of [null, undefined, '', '   ']) {
    const f = fakes();
    const r = await resolveReference({ pbotID: 'ref-missing', pbdbid }, f);
    assert.deepEqual(r, { id: null, via: null, classicTitle: null });
    assert.deepEqual(f.calls.byPbdbID, []);
  }
});

test('a dangling pbdbid returns no id', async () => {
  const f = fakes();
  const r = await resolveReference({ pbotID: 'ref-missing', pbdbid: '99999' }, f);
  assert.deepEqual(r, { id: null, via: null, classicTitle: null });
  assert.deepEqual(f.calls.byPbdbID, ['99999']);
});
