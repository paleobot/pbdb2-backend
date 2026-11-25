import { test } from 'node:test';
import assert from 'node:assert/strict';

import { identifiedName } from '../src/lib/identified-name.js';

/** The formatted identification name (occurrence-reads; design D7), one rule at a time. */

test('ranks in order, the subgenus in parentheses', () => {
  assert.equal(
    identifiedName({ subspecies: { name: 'minor' }, species: { name: 'bovidens' }, subgenus: { name: 'Foo' }, genus: { name: 'Dielasma' } }),
    'Dielasma (Foo) bovidens minor',
  );
});

test('?, cf., aff. and ex gr. go before the name, inside the subgenus parentheses too', () => {
  assert.equal(identifiedName({ genus: { resolution: 'cf.', name: 'Dielasma' } }), 'cf. Dielasma');
  assert.equal(identifiedName({ genus: { name: 'Dielasma' }, species: { resolution: 'aff.', name: 'bovidens' } }), 'Dielasma aff. bovidens');
  assert.equal(identifiedName({ genus: { name: 'Dielasma' }, subgenus: { resolution: 'cf.', name: 'Foo' }, species: { name: 'bar' } }), 'Dielasma (cf. Foo) bar');
  assert.equal(identifiedName({ genus: { resolution: '?', name: 'Dielasma' } }), '? Dielasma');
  assert.equal(identifiedName({ genus: { name: 'Dielasma' }, species: { resolution: 'ex gr.', name: 'bovidens' } }), 'Dielasma ex gr. bovidens');
});

test('n. gen., n. subgen., n. sp., n. ssp., sensu lato and sensu stricto go after it', () => {
  assert.equal(identifiedName({ genus: { resolution: 'n. gen.', name: 'Foo' }, species: { resolution: 'n. sp.', name: 'bar' } }), 'Foo n. gen. bar n. sp.');
  assert.equal(identifiedName({ genus: { name: 'Foo' }, subgenus: { resolution: 'n. subgen.', name: 'Baz' } }), 'Foo (Baz n. subgen.)');
  assert.equal(identifiedName({ genus: { name: 'Foo' }, species: { name: 'bar' }, subspecies: { resolution: 'n. ssp.', name: 'qux' } }), 'Foo bar qux n. ssp.');
  assert.equal(identifiedName({ genus: { resolution: 'sensu lato', name: 'Foo' } }), 'Foo sensu lato');
  assert.equal(identifiedName({ genus: { name: 'Foo' }, species: { resolution: 'sensu stricto', name: 'bar' } }), 'Foo bar sensu stricto');
});

test('the subspecies qualifiers go before it, as stored', () => {
  for (const q of ['var', 'morph', 'forma', 'mut']) {
    assert.equal(identifiedName({ genus: { name: 'Foo' }, species: { name: 'bar' }, subspecies: { resolution: q, name: 'minor' } }), `Foo bar ${q} minor`);
  }
});

test('informal and the ditto mark are left out, the name kept', () => {
  assert.equal(identifiedName({ genus: { resolution: 'informal', name: 'Bigfoot' }, species: { resolution: '"', name: 'sp.' } }), 'Bigfoot sp.');
});

test('the spec scenarios', () => {
  assert.equal(identifiedName({ genus: { resolution: 'cf.', name: 'Dielasma' }, species: { resolution: 'n. sp.', name: 'bovidens' } }), 'cf. Dielasma bovidens n. sp.');
  assert.equal(identifiedName({ genus: { name: 'Dielasma' }, subgenus: { resolution: '?', name: 'Foo' }, species: { name: 'bar' } }), 'Dielasma (? Foo) bar');
});

test('a rank with no name is skipped; stored names are written as they are', () => {
  assert.equal(identifiedName({ genus: { name: 'Foo' }, subgenus: { resolution: 'cf.' }, species: { name: 'sp.' } }), 'Foo sp.');
  assert.equal(identifiedName({ species: { name: 'indet.' } }), 'indet.');
});

test('no rank name gives null', () => {
  assert.equal(identifiedName({}), null);
  assert.equal(identifiedName(undefined), null);
  assert.equal(identifiedName({ genus: { resolution: 'cf.' } }), null);
});
