import { test } from 'node:test';
import assert from 'node:assert/strict';

import { risSerializer, risType } from '../src/lib/ris.js';
import { referenceSource } from '../../payloadSchemas/reference.schema.js';

/**
 * RIS records (ris-output; design D4–D7): the type table, tag order and
 * precedence, omission of blank values, editors' tag by type, and encoding.
 */

const BASE = 'http://localhost:3000/api/v1/references';
const ris = risSerializer(referenceSource, { baseHref: BASE });

/** The lines of one record, without the record terminator's blank line. */
function lines(record) {
  const text = ris.record(record);
  assert.ok(text.endsWith('ER  - \r\n\r\n'), 'a record ends with ER and a blank line');
  return text.slice(0, -4).split('\r\n').slice(0, -1);
}

const tags = (record) => lines(record).map((l) => l.slice(0, 2));
const value = (record, tag) => lines(record).filter((l) => l.startsWith(`${tag}  - `)).map((l) => l.slice(6));

const ref = (fields) => ({ permid: 'REF-0000001-12', publicationYear: '1998', ...fields });

test('every publication type maps to its RIS type', () => {
  const cases = [
    [{ publicationType: 'journal article' }, 'JOUR'],
    [{ publicationType: 'article in edited collection' }, 'CHAP'],
    [{ publicationType: 'edited collection' }, 'EDBOOK'],
    [{ publicationType: 'serial monograph' }, 'SER'],
    [{ publicationType: 'standalone book', bookType: 'Ph.D. thesis' }, 'THES'],
    [{ publicationType: 'standalone book', bookType: 'M.S. thesis' }, 'THES'],
    [{ publicationType: 'standalone book', bookType: 'monograph' }, 'BOOK'],
    [{ publicationType: 'standalone book' }, 'BOOK'],
    [{ publicationType: 'unpublished' }, 'UNPD'],
    [{ publicationType: 'other' }, 'GEN'],
  ];
  for (const [fields, ty] of cases) {
    assert.equal(risType(fields), ty, JSON.stringify(fields));
    assert.equal(lines(ref(fields))[0], `TY  - ${ty}`);
  }
});

test('a thesis carries M3 = bookType; a monograph and other types do not', () => {
  assert.deepEqual(value(ref({ publicationType: 'standalone book', bookType: 'Ph.D. thesis' }), 'M3'), ['Ph.D. thesis']);
  assert.deepEqual(value(ref({ publicationType: 'standalone book', bookType: 'monograph' }), 'M3'), []);
  assert.deepEqual(value(ref({ publicationType: 'other', bookType: 'Ph.D. thesis' }), 'M3'), []);
});

test('a minimal record has only TY, ID, UR, DB, PY and ER', () => {
  assert.deepEqual(tags(ref({ publicationType: 'journal article' })), ['TY', 'ID', 'UR', 'DB', 'PY']);
});

test('the link back: ID is the permid, UR the absolute API URL', () => {
  const r = ref({ publicationType: 'journal article' });
  assert.deepEqual(value(r, 'ID'), ['REF-0000001-12']);
  assert.deepEqual(value(r, 'UR'), [`${BASE}/REF-0000001-12`]);
  assert.deepEqual(value(r, 'DB'), ['Paleobiology Database']);
});

test('every tag in the fixed order', () => {
  const r = ref({
    publicationType: 'other',
    title: 'T',
    authors: [{ familyName: 'A', givenName: 'B.' }],
    editors: 'E',
    journalTitle: 'J',
    journalVolume: '1',
    journalNumber: '2',
    pages: { first: 3, last: 4 },
    publisher: 'P',
    publicationCity: 'C',
    comments: 'note',
    description: 'desc',
    language: 'English',
    doi: '10.1/x',
    legacyIDs: { oldpbdbID: '7' },
  });
  assert.deepEqual(tags(r), [
    'TY', 'ID', 'UR', 'DB', 'AU', 'A2', 'PY', 'TI', 'T2', 'VL', 'IS', 'SP', 'EP', 'PB', 'CY', 'N1', 'N1', 'LA', 'DO',
  ]);
  assert.ok(!ris.record(r).includes('7\r\n'), 'legacyIDs are never exported');
});

test('blank and null values are omitted', () => {
  const r = ref({
    publicationType: 'journal article',
    title: '  ',
    journalTitle: null,
    journalVolume: '',
    comments: '\r\n',
    authors: [],
  });
  assert.deepEqual(tags(r), ['TY', 'ID', 'UR', 'DB', 'PY']);
});

test('a journal article: T2, VL, IS, SP, EP and DO in order', () => {
  const r = ref({
    publicationType: 'journal article',
    journalTitle: 'Journal of Paleontology',
    journalVolume: '72',
    journalNumber: '3',
    pages: { first: 401, last: 420 },
    doi: '10.1017/S0022336000024100',
  });
  assert.deepEqual(lines(r).slice(-6), [
    'T2  - Journal of Paleontology',
    'VL  - 72',
    'IS  - 3',
    'SP  - 401',
    'EP  - 420',
    'DO  - 10.1017/S0022336000024100',
  ]);
});

test('container precedence: journal, then book, then series', () => {
  const t2 = (fields) => value(ref({ publicationType: 'other', ...fields }), 'T2');
  assert.deepEqual(t2({ journalTitle: 'J', bookTitle: 'B', seriesTitle: 'S' }), ['J']);
  assert.deepEqual(t2({ bookTitle: 'B', seriesTitle: 'S' }), ['B']);
  assert.deepEqual(t2({ journalTitle: ' ', seriesTitle: 'S' }), ['S']);
  assert.deepEqual(value(ref({ publicationType: 'article in edited collection', bookTitle: 'Dinosaur Tracks' }), 'T2'), ['Dinosaur Tracks']);
});

test('volume and number precedence: journal, then series', () => {
  const r = (fields) => ref({ publicationType: 'other', ...fields });
  assert.deepEqual(value(r({ journalVolume: '1', seriesVolume: '2' }), 'VL'), ['1']);
  assert.deepEqual(value(r({ seriesVolume: '2' }), 'VL'), ['2']);
  assert.deepEqual(value(r({ journalNumber: '3', seriesNumber: '4' }), 'IS'), ['3']);
  assert.deepEqual(value(r({ seriesNumber: '4' }), 'IS'), ['4']);
});

test('a serial monograph: series title in T2, seriesVolume in VL, seriesNumber in M1', () => {
  const r = ref({
    publicationType: 'serial monograph',
    seriesTitle: 'Bulletin of the New Mexico Museum of Natural History and Science',
    seriesVolume: '62',
    seriesNumber: '2',
  });
  assert.deepEqual(value(r, 'T2'), ['Bulletin of the New Mexico Museum of Natural History and Science']);
  assert.deepEqual(value(r, 'VL'), ['62']);
  assert.deepEqual(value(r, 'M1'), ['2']);
  assert.deepEqual(value(r, 'IS'), []);
});

test('the number is M1 on book types and IS on the rest', () => {
  const cases = [
    [{ publicationType: 'serial monograph' }, 'M1'],
    [{ publicationType: 'edited collection' }, 'M1'],
    [{ publicationType: 'standalone book' }, 'M1'],
    [{ publicationType: 'standalone book', bookType: 'Ph.D. thesis' }, 'M1'],
    [{ publicationType: 'journal article' }, 'IS'],
    [{ publicationType: 'article in edited collection' }, 'IS'],
    [{ publicationType: 'other' }, 'IS'],
    [{ publicationType: 'unpublished' }, 'IS'],
  ];
  for (const [fields, tag] of cases) {
    const r = ref({ ...fields, seriesNumber: '7' });
    assert.deepEqual(value(r, tag), ['7'], JSON.stringify(fields));
    assert.deepEqual(value(r, tag === 'IS' ? 'M1' : 'IS'), []);
  }
});

test('on book types and unpublished, pages are one SP: a count from page 1, else the range', () => {
  for (const fields of [
    { publicationType: 'serial monograph' },
    { publicationType: 'edited collection' },
    { publicationType: 'standalone book' },
    { publicationType: 'standalone book', bookType: 'M.S. thesis' },
    { publicationType: 'unpublished' },
  ]) {
    const pages = (p) => ({ SP: value(ref({ ...fields, pages: p }), 'SP'), EP: value(ref({ ...fields, pages: p }), 'EP') });
    assert.deepEqual(pages({ first: 1, last: 94 }), { SP: ['94'], EP: [] }, JSON.stringify(fields));
    assert.deepEqual(pages({ first: 834, last: 848 }), { SP: ['834-848'], EP: [] });
    assert.deepEqual(pages({ first: 12, last: 12 }), { SP: ['12'], EP: [] });
    assert.deepEqual(pages({ first: 1, last: 1 }), { SP: ['1'], EP: [] });
    assert.deepEqual(pages({ first: 5 }), { SP: ['5'], EP: [] });
    assert.deepEqual(pages({ last: 40 }), { SP: ['40'], EP: [] });
  }
  for (const publicationType of ['journal article', 'article in edited collection', 'other']) {
    const r = ref({ publicationType, pages: { first: 1, last: 94 } });
    assert.deepEqual([value(r, 'SP'), value(r, 'EP')], [['1'], ['94']], publicationType);
  }
});

test('a single page has SP and no EP', () => {
  const r = ref({ publicationType: 'journal article', pages: { first: 12, last: 12 } });
  assert.deepEqual(value(r, 'SP'), ['12']);
  assert.deepEqual(value(r, 'EP'), []);
});

test('comments and description are two N1 lines, comments first', () => {
  const r = ref({ publicationType: 'unpublished', comments: 'Comment.', description: 'Thesis draft.' });
  assert.deepEqual(value(r, 'N1'), ['Comment.', 'Thesis draft.']);
});

test('a reference with no title has no TI line and is otherwise complete', () => {
  const r = ref({ publicationType: 'journal article', authors: [{ familyName: 'Smith' }], journalTitle: 'J' });
  assert.deepEqual(tags(r), ['TY', 'ID', 'UR', 'DB', 'AU', 'PY', 'T2']);
});

test('authors: family name first; family only; given only; neither skipped', () => {
  const r = ref({
    publicationType: 'journal article',
    authors: [
      { familyName: 'Bone', givenName: 'D. A.' },
      { familyName: 'Smith' },
      { familyName: 'Jones', givenName: ' ' },
      { familyName: '', givenName: 'Plato' },
      { familyName: ' ', givenName: '' },
      {},
    ],
  });
  assert.deepEqual(value(r, 'AU'), ['Bone, D. A.', 'Smith', 'Jones', 'Plato']);
});

test('editors are one unparsed line, A3 on book types and A2 on the rest', () => {
  const editors = 'P. L. Falkingham, D. Marty, & A. Richter';
  const cases = [
    [{ publicationType: 'serial monograph' }, 'A3'],
    [{ publicationType: 'edited collection' }, 'A3'],
    [{ publicationType: 'standalone book' }, 'A3'],
    [{ publicationType: 'standalone book', bookType: 'M.S. thesis' }, 'A3'],
    [{ publicationType: 'article in edited collection' }, 'A2'],
    [{ publicationType: 'journal article' }, 'A2'],
    [{ publicationType: 'other' }, 'A2'],
    [{ publicationType: 'unpublished' }, 'A2'],
  ];
  for (const [fields, tag] of cases) {
    const r = ref({ ...fields, editors });
    assert.deepEqual(value(r, tag), [editors], JSON.stringify(fields));
    assert.deepEqual(value(r, tag === 'A2' ? 'A3' : 'A2'), []);
  }
});

test('a multi-line comment becomes one line', () => {
  const r = ref({ publicationType: 'journal article', comments: 'First line.\r\n  Second line.' });
  assert.deepEqual(value(r, 'N1'), ['First line. Second line.']);
  const twoBreaks = ref({ publicationType: 'journal article', comments: 'a\n\nb\rc  d' });
  assert.deepEqual(value(twoBreaks, 'N1'), ['a b c  d'], 'only runs containing CR or LF collapse');
});

test('long values are not truncated', () => {
  const long = 'x'.repeat(600);
  assert.deepEqual(value(ref({ publicationType: 'journal article', title: long }), 'TI'), [long]);
});

test('non-ASCII text is written as UTF-8, unescaped', () => {
  const text = ris.record(ref({ publicationType: 'journal article', authors: [{ familyName: 'Jiménez-Hidalgo', givenName: 'E.' }] }));
  assert.ok(text.includes('AU  - Jiménez-Hidalgo, E.\r\n'));
  assert.notEqual(Buffer.from(text, 'utf8')[0], 0xef, 'no byte order mark');
});

test('header is empty and two records are separated by one blank line', () => {
  assert.equal(ris.header(), '');
  const body = ris.header() + [ref({ publicationType: 'journal article' }), ref({ publicationType: 'other' })].map(ris.record).join('');
  assert.match(body, /^TY {2}- JOUR\r\n/);
  assert.match(body, /ER {2}- \r\n\r\nTY {2}- GEN\r\n/);
  assert.equal(body.split('\r\n\r\n').length, 3, 'two records, each followed by one blank line');
});

test('exact bytes of one full record', () => {
  const r = {
    permid: 'REF-0000042-77',
    publicationType: 'article in edited collection',
    title: 'Tracks of the\nLate Jurassic',
    authors: [{ familyName: 'Bone', givenName: 'D. A.' }, { familyName: 'Smith' }],
    publicationYear: '2016',
    pages: { first: 10, last: 25 },
    doi: '10.1/abc',
    language: 'English',
    comments: 'Reprinted.',
    bookTitle: 'Dinosaur Tracks',
    publisher: 'Indiana University Press',
    editors: 'P. L. Falkingham, D. Marty, & A. Richter',
    publicationCity: 'Bloomington',
    legacyIDs: { oldpbdbID: '123' },
  };
  assert.equal(
    ris.record(r),
    'TY  - CHAP\r\n' +
      'ID  - REF-0000042-77\r\n' +
      `UR  - ${BASE}/REF-0000042-77\r\n` +
      'DB  - Paleobiology Database\r\n' +
      'AU  - Bone, D. A.\r\n' +
      'AU  - Smith\r\n' +
      'A2  - P. L. Falkingham, D. Marty, & A. Richter\r\n' +
      'PY  - 2016\r\n' +
      'TI  - Tracks of the Late Jurassic\r\n' +
      'T2  - Dinosaur Tracks\r\n' +
      'SP  - 10\r\n' +
      'EP  - 25\r\n' +
      'PB  - Indiana University Press\r\n' +
      'CY  - Bloomington\r\n' +
      'N1  - Reprinted.\r\n' +
      'LA  - English\r\n' +
      'DO  - 10.1/abc\r\n' +
      'ER  - \r\n' +
      '\r\n',
  );
});
