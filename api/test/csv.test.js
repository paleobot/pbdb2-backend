import { test } from 'node:test';
import assert from 'node:assert/strict';

import { csvColumns, csvField, csvSerializer } from '../src/lib/csv.js';
import { authoritySource } from '../../payloadSchemas/authority.schema.js';
import { collectionSource } from '../../payloadSchemas/collection.schema.js';
import { referenceSource } from '../../payloadSchemas/reference.schema.js';
import { taxonSource } from '../../payloadSchemas/taxon.schema.js';
import { parseCsv } from './csv-parse.js';

/**
 * CSV columns and encoding (csv-output; design D3–D5, D12). Columns come from
 * the `out` variant alone; cells follow the flattening rules.
 */

const names = (source) => csvColumns(source).map((c) => c.name);

/** One record's line, as written. */
const lineFor = (source, record) => csvSerializer(source).record(record);

/** The cell for `column` in one record's line, parsed back from RFC 4180. */
function cellOf(source, record, column) {
  const [fields] = parseCsv(lineFor(source, record));
  assert.equal(fields.length, names(source).length, 'one field per column');
  return fields[names(source).indexOf(column)];
}

test('columns follow schema order, permid first, from the out variant', () => {
  for (const source of [authoritySource, collectionSource, referenceSource, taxonSource]) {
    assert.equal(names(source)[0], 'permid', source.title);
  }
  assert.deepEqual(names(authoritySource), [
    'permid', 'citation', 'reference.permid', 'reference.title', 'descriptors', 'year',
    'publishedInReference', 'legacyIDs.oldpbdbIDs',
  ]);
  assert.deepEqual(names(taxonSource), [
    'permid', 'name', 'rank', 'nomenclaturalStatus', 'authority.permid', 'authority.citation',
    'accepted.permid', 'accepted.name',
  ]);
});

test('each shape maps to its columns', () => {
  const collection = names(collectionSource);
  assert.ok(collection.includes('location.coordinates.latitude'), 'a nested object: a dotted path');
  assert.ok(collection.includes('lithofacies.adjectives'), 'an array inside an array of objects');
  assert.ok(collection.includes('additionalReferences.permid'), 'an array of links: permids');
  assert.ok(!collection.includes('additionalReferences.title'), 'and no titles');
  assert.ok(collection.includes('primaryReference.title'), 'a single link: its label');
  assert.ok(!collection.some((n) => n.endsWith('.href')), 'never an href');

  const reference = names(referenceSource);
  assert.ok(reference.includes('authors.familyName') && reference.includes('authors.givenName'), 'parallel columns');
  assert.ok(reference.includes('pages.first'));
  assert.equal(new Set(reference).size, reference.length, 'no column twice');
});

test('a link gives its permid and label; null and absent are empty', () => {
  const link = { permid: 'REF-1-00', title: 'A title', href: 'http://x/REF-1-00' };
  assert.equal(cellOf(authoritySource, { reference: link }, 'reference.permid'), 'REF-1-00');
  assert.equal(cellOf(authoritySource, { reference: link }, 'reference.title'), 'A title');
  assert.equal(cellOf(authoritySource, { reference: null }, 'reference.permid'), '', 'a removed target');
  assert.equal(cellOf(authoritySource, {}, 'year'), '', 'an absent field');
  assert.equal(cellOf(authoritySource, { descriptors: [] }, 'descriptors'), '', 'an empty array');
});

test('scalars are written as JSON spells them', () => {
  assert.equal(cellOf(authoritySource, { publishedInReference: true }, 'publishedInReference'), 'true');
  assert.equal(cellOf(authoritySource, { publishedInReference: false }, 'publishedInReference'), 'false');
  assert.equal(cellOf(collectionSource, { location: { coordinates: { latitude: -33.5 } } }, 'location.coordinates.latitude'), '-33.5');
});

test('parallel columns stay aligned, a missing value keeping its place', () => {
  const record = {
    authors: [{ familyName: 'Smith', givenName: 'A' }, { familyName: 'Jones' }, { familyName: 'Lee', givenName: 'C' }],
  };
  assert.equal(cellOf(referenceSource, record, 'authors.familyName'), 'Smith|Jones|Lee');
  assert.equal(cellOf(referenceSource, record, 'authors.givenName'), 'A||C');
});

test('an array inside an array joins with ; within | ', () => {
  const record = {
    lithofacies: [
      { lithology: 'sandstone', adjectives: ['sandy', 'fine'] },
      { lithology: 'shale', adjectives: ['shaly'] },
      { lithology: 'claystone' },
    ],
  };
  assert.equal(cellOf(collectionSource, record, 'lithofacies.adjectives'), 'sandy;fine|shaly|');
  assert.equal(cellOf(collectionSource, record, 'lithofacies.lithology'), 'sandstone|shale|claystone');
});

test('arrays of scalars and of links', () => {
  assert.equal(cellOf(authoritySource, { descriptors: ['a', 'b'] }, 'descriptors'), 'a|b');
  const record = { additionalReferences: [{ permid: 'REF-1-00', title: 'x' }, { permid: 'REF-2-00', title: 'y' }] };
  assert.equal(cellOf(collectionSource, record, 'additionalReferences.permid'), 'REF-1-00|REF-2-00');
});

test('inside an array, \\, | and ; are escaped; separators are bare', () => {
  const authors = [{ familyName: 'Smith' }, { familyName: 'Ab|cd' }, { familyName: 'Lee' }];
  assert.equal(cellOf(referenceSource, { authors }, 'authors.familyName'), 'Smith|Ab\\|cd|Lee');
  assert.equal(cellOf(authoritySource, { descriptors: ['a\\', 'b'] }, 'descriptors'), 'a\\\\|b');
  assert.equal(cellOf(authoritySource, { descriptors: ['x;y'] }, 'descriptors'), 'x\\;y');
});

test('a single-valued column is never escaped', () => {
  assert.equal(cellOf(referenceSource, { title: 'A | B; C\\D' }, 'title'), 'A | B; C\\D');
});

test('RFC 4180: quoting, doubled quotes, preserved line breaks, CRLF', () => {
  assert.equal(csvField('plain'), 'plain');
  assert.equal(csvField('a,b'), '"a,b"');
  assert.equal(csvField('say "hi"'), '"say ""hi"""');
  assert.equal(csvField('line 1\nline 2'), '"line 1\nline 2"');
  assert.equal(csvField('cr\r'), '"cr\r"');

  const line = lineFor(referenceSource, { permid: 'REF-1-00', comments: 'one\ntwo "three"' });
  assert.ok(line.endsWith('\r\n'));
  assert.equal(cellOf(referenceSource, { comments: 'one\ntwo "three"' }, 'comments'), 'one\ntwo "three"');
});

test('a formula-like value is written unchanged', () => {
  for (const value of ['=SUM(A1)', '+1', '-2', '@x']) {
    assert.equal(cellOf(referenceSource, { title: value }, 'title'), value);
  }
});

test('the header is the column names, and the same for any record', () => {
  const serializer = csvSerializer(referenceSource);
  assert.equal(serializer.header(), `${names(referenceSource).join(',')}\r\n`);
  assert.equal(serializer.header(), csvSerializer(referenceSource).header());
});

test('an undeclared key is not exported', () => {
  const line = lineFor(referenceSource, { permid: 'REF-1-00', notInTheSchema: 'secret' });
  assert.ok(!line.includes('secret'));
});
