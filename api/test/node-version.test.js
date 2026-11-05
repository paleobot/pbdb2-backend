import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isAtLeast, readMinimumNode } from '../src/app.js';

test('a running version is compared numerically against the minimum', () => {
  assert.equal(isAtLeast('26.12.0', '26.12.1'), false);
  assert.equal(isAtLeast('26.12.1', '26.12.1'), true);
  assert.equal(isAtLeast('26.100.0', '26.12.1'), true);
  assert.equal(isAtLeast('27.0.0', '26.12.1'), true);
  assert.equal(isAtLeast('25.6.1', '26.12.1'), false);
});

test('the minimum is read from a >=MAJOR.MINOR.PATCH range', () => {
  assert.equal(readMinimumNode('>=26.12.1'), '26.12.1');
});

test('raising the floor rejects the old minimum', () => {
  assert.equal(isAtLeast('26.12.1', readMinimumNode('>=26.13.0')), false);
});

test('any other range form is rejected, naming the value', () => {
  for (const range of ['^26.12.1', '>=26', '26.12.1', undefined]) {
    assert.throws(
      () => readMinimumNode(range),
      (err) => err.message.endsWith(`got ${JSON.stringify(range)}`),
      String(range),
    );
  }
});
