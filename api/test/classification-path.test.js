import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ancestorPermids, pathDepth } from '../src/lib/classification-path.js';

/**
 * The path decoder is the single place `classification_path`'s encoding is
 * understood, so these pin both traps it exists to handle: the underscore
 * substitution ltree forces, and the fact that the final element is the taxon's
 * own concept rather than an ancestor.
 *
 * The fixtures are real rows from the development database (2026-09-11), not
 * invented shapes — the same measurement discipline as
 * `docs/taxa-classification-reads.md`.
 */

// A real depth-3 row. Its permid equals its concept_permid, and the path's last
// element is that concept.
const DEPTH_3 =
  '01a08827_6c18_70bb_a61b_537882be2fd1.01a08827_5db4_7561_ba19_a10fe5dbdcc1.01a08827_5ef9_71e5_a761_ba1298b75732';
const DEPTH_3_OWN_CONCEPT = '01a08827-5ef9-71e5-a761-ba1298b75732';

// A real root row: one element, which is its own concept.
const ROOT = '01a08827_5ecf_740e_8bff_6cd5a54a506a';

test('a multi-level path decodes to its ancestors, root-first', () => {
  assert.deepEqual(ancestorPermids(DEPTH_3), [
    '01a08827-6c18-70bb-a61b-537882be2fd1',
    '01a08827-5db4-7561-ba19-a10fe5dbdcc1',
  ]);
});

test('the taxon\'s own concept is never among its ancestors', () => {
  assert.ok(
    !ancestorPermids(DEPTH_3).includes(DEPTH_3_OWN_CONCEPT),
    'the final path element is the taxon itself, not an ancestor',
  );
});

test('labels round-trip to canonical hyphenated permids', () => {
  const [first] = ancestorPermids(DEPTH_3);
  // ltree cannot hold `-`, so the stored label carries `_`; UUIDs contain no
  // `_` of their own, which is what makes the substitution lossless.
  assert.match(first, /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  assert.ok(!first.includes('_'));
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
