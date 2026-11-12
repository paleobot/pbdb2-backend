import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  pbotToken, pbotHeaders, pbotAccessLabel, includePrivateRequested, PBOT_INCLUDE_PRIVATE_FLAG,
} from '../lib/pbot.js';

const saved = process.env.PBOT_TOKEN;
afterEach(() => {
  if (saved === undefined) delete process.env.PBOT_TOKEN;
  else process.env.PBOT_TOKEN = saved;
});

function setToken(value) {
  if (value === undefined) delete process.env.PBOT_TOKEN;
  else process.env.PBOT_TOKEN = value;
}

const JSON_ONLY = { 'Content-Type': 'application/json' };

for (const [label, value] of [['unset', undefined], ['empty', ''], ['whitespace-only', '   ']]) {
  test(`${label} PBOT_TOKEN is no token`, () => {
    setToken(value);
    assert.equal(pbotToken(), null);
    assert.deepEqual(pbotHeaders(false), JSON_ONLY);
    assert.throws(() => pbotHeaders(true), /PBOT_TOKEN/);
  });
}

test('a set token is trimmed and sent only when asked for', () => {
  setToken('  abc.def  ');
  assert.equal(pbotToken(), 'abc.def');
  assert.deepEqual(pbotHeaders(false), JSON_ONLY);
  assert.deepEqual(pbotHeaders(true), { ...JSON_ONLY, Authorization: 'Bearer abc.def' });
});

test('the include-private flag is detected', () => {
  assert.equal(PBOT_INCLUDE_PRIVATE_FLAG, '--pbot-include-private');
  assert.equal(includePrivateRequested(['--createdb', '--pbot-include-private']), true);
  assert.equal(includePrivateRequested(['--createdb']), false);
  assert.equal(includePrivateRequested([]), false);
});

test('access labels', () => {
  assert.equal(pbotAccessLabel(true), 'token, including private records');
  assert.equal(pbotAccessLabel(false), 'anonymous, public records only');
});
