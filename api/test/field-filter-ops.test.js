import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FIELD_FILTER_OPS, filterOp } from '../src/lib/field-filter-ops.js';

/**
 * The match kinds, one stage at a time: each `parse` on its own, and the SQL
 * each `predicate` emits with the values it binds. What the SQL *means* (case,
 * accents, prefixes, range ends) needs a real database and is asserted in
 * test/integration/reads.test.js.
 */

const httpErrors = {
  badRequest: (message) => Object.assign(new Error(message), { statusCode: 400 }),
};

const parse = (op, value, param = 'p') => FIELD_FILTER_OPS[op].parse(value, param, httpErrors);
const rejects = (op, value, message, param = 'p') =>
  assert.throws(() => parse(op, value, param), (e) => e.statusCode === 400 && e.message === message);

/** The fragment and the values it bound, starting from `$1`. */
function predicate(op, parsed) {
  const values = [];
  const bind = (value) => {
    values.push(value);
    return `$${values.length}`;
  };
  const sql = FIELD_FILTER_OPS[op].predicate({ payload: '"reference"', key: "'f'", bind }, parsed);
  return { sql, values };
}

test('doi: a resolver URL or doi: prefix is removed and the DOI lowercased', () => {
  for (const value of ['10.1234/ABC', 'https://doi.org/10.1234/abc', 'http://dx.doi.org/10.1234/Abc', 'DOI: 10.1234/abc']) {
    assert.equal(parse('doi', value), '10.1234/abc', value);
  }
  rejects('doi', 'https://doi.org/', '`doi` must contain a DOI after its prefix', 'doi');
});

test('doi: the stored value is normalized by the same prefix pattern, bound', () => {
  const { sql, values } = predicate('doi', '10.1234/abc');
  assert.equal(sql, `lower(regexp_replace("reference"->>'f', $1, '', 'i')) = $2`);
  assert.equal(new RegExp(values[0], 'i').test('https://doi.org/x'), true);
  assert.equal(values[1], '10.1234/abc');
});

test('allWords: split on whitespace and de-duplicated', () => {
  assert.deepEqual(parse('allWords', 'triassic  archosaur triassic'), ['triassic', 'archosaur']);
});

test('allWords: LIKE wildcards and the escape character are bound escaped', () => {
  assert.deepEqual(predicate('allWords', ['100%', 'a_b', 'c\\d']).values, ['100\\%', 'a\\_b', 'c\\\\d']);
});

test('allWords: one accent-folded ILIKE per word, joined with AND', () => {
  const { sql, values } = predicate('allWords', ['triassic', 'archosaur']);
  assert.equal(
    sql,
    `unaccent("reference"->>'f') ILIKE ('%' || unaccent($1) || '%') AND ` +
      `unaccent("reference"->>'f') ILIKE ('%' || unaccent($2) || '%')`,
  );
  assert.deepEqual(values, ['triassic', 'archosaur']);
});

test('familyNames: comma-separated, trimmed, de-duplicated; an empty item is a 400', () => {
  assert.deepEqual(parse('familyNames', 'Sues, Reisz,Sues'), ['Sues', 'Reisz']);
  for (const value of ['Sues,', ',Reisz', 'Sues,,Reisz', 'Sues, ']) {
    rejects('familyNames', value, '`authors` must not contain an empty name', 'authors');
  }
});

test('familyNames: one EXISTS per name over the array, joined with AND', () => {
  const { sql, values } = predicate('familyNames', ['Sues', 'Reisz']);
  const one = (n) =>
    `EXISTS (SELECT 1 FROM jsonb_array_elements("reference"->'f') a ` +
    `WHERE lower(unaccent(a->>'familyName')) = lower(unaccent($${n})))`;
  assert.equal(sql, `${one(1)} AND ${one(2)}`);
  assert.deepEqual(values, ['Sues', 'Reisz']);
});

test('firstFamilyName: one name; a comma is a 400 pointing at authors', () => {
  assert.equal(parse('firstFamilyName', 'de la Fuente'), 'de la Fuente');
  rejects('firstFamilyName', 'Sues,Reisz', '`firstAuthor` takes one family name; use `authors` for several', 'firstAuthor');
  const { sql, values } = predicate('firstFamilyName', 'Sues');
  assert.equal(sql, `lower(unaccent("reference"->'f'->0->>'familyName')) = lower(unaccent($1))`);
  assert.deepEqual(values, ['Sues']);
});

test('yearRange: a year is a one-year range; a range keeps its ends; reversed is a 400', () => {
  assert.deepEqual(parse('yearRange', '1990'), { from: 1990, to: 1990 });
  assert.deepEqual(parse('yearRange', '1990-2000'), { from: 1990, to: 2000 });
  assert.deepEqual(parse('yearRange', '1990-1990'), { from: 1990, to: 1990 });
  rejects(
    'yearRange', '2000-1990',
    '`publicationYear` range 2000-1990 is reversed; write the earlier year first', 'publicationYear',
  );
});

test('yearRange: a guarded cast, BETWEEN the bound ends', () => {
  const { sql, values } = predicate('yearRange', { from: 1990, to: 2000 });
  assert.equal(
    sql,
    `(CASE WHEN "reference"->>'f' ~ '^[0-9]{4}$' THEN ("reference"->>'f')::int END) BETWEEN $1 AND $2`,
  );
  assert.deepEqual(values, [1990, 2000]);
});

test('eq: the raw value, compared as before', () => {
  assert.equal(parse('eq', 'standalone book'), 'standalone book');
  assert.deepEqual(predicate('eq', 'x'), { sql: `"reference"->>'f' = $1`, values: ['x'] });
});

test('an unknown op is an error naming it', () => {
  assert.throws(() => filterOp('like'), /Unknown field-filter op 'like'/);
});
