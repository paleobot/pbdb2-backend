import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ancestorPermids, pathDepth } from '../src/lib/classification-path.js';

/**
 * The path decoder is the single place `classification_path`'s encoding is
 * understood, so these pin what it handles: labels are the permids as stored,
 * and the final element is the taxon's own concept rather than an ancestor.
 *
 * The fixtures have the shape of real rows (TXN permids, PostgreSQL 16+ ltree
 * labels with `-`), with numbers chosen for the test.
 */

// A depth-3 row. Its permid equals its concept_permid, and the path's last
// element is that concept.
const DEPTH_3 = 'TXN-28595-53.TXN-52941-56.TXN-69296-73';
const DEPTH_3_OWN_CONCEPT = 'TXN-69296-73';

// A root row: one element, which is its own concept.
const ROOT = 'TXN-1-51';

test('a multi-level path decodes to its ancestors, root-first', () => {
  assert.deepEqual(ancestorPermids(DEPTH_3), ['TXN-28595-53', 'TXN-52941-56']);
});

test('the taxon\'s own concept is never among its ancestors', () => {
  assert.ok(
    !ancestorPermids(DEPTH_3).includes(DEPTH_3_OWN_CONCEPT),
    'the final path element is the taxon itself, not an ancestor',
  );
});

test('labels are the permids as stored, hyphens included', () => {
  const [first] = ancestorPermids(DEPTH_3);
  assert.equal(first, 'TXN-28595-53');
});

test('a root taxon has no ancestors', () => {
  assert.deepEqual(ancestorPermids(ROOT), []);
});

test('a missing path yields no ancestors rather than throwing', () => {
  // A backend reshape must degrade to "no ancestors", never to a 500 on every
  // taxa read.
  assert.deepEqual(ancestorPermids(null), []);
  assert.deepEqual(ancestorPermids(undefined), []);
  assert.deepEqual(ancestorPermids(''), []);
});

test('depth counts the taxon itself, matching nlevel()', () => {
  assert.equal(pathDepth(DEPTH_3), 3);
  assert.equal(pathDepth(ROOT), 1);
  assert.equal(pathDepth(null), 0);
});

test('ancestor count is always one less than depth', () => {
  for (const path of [DEPTH_3, ROOT]) {
    assert.equal(ancestorPermids(path).length, pathDepth(path) - 1, path);
  }
});
