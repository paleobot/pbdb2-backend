import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasTwoTitles, mapPublicationType, mapPubtitle, mapTitle, buildEditors, containerNote, buildJsonb,
  inReviewGroup, reviewSignals, reviewRow,
} from '../refs-migration/migrate-refs.js';
import { referenceSource } from '../../../payloadSchemas/reference.schema.js';
import { applyEnums } from '../../../payloadSchemas/lib/enums.js';
import { deriveVariant } from '../../../payloadSchemas/lib/variants.js';
import { createAjv } from '../../../payloadSchemas/lib/ajv.js';

const noEditors = new Map();

// A source row with every column the script reads; overrides fill the case.
const row = (over) => ({
  reference_no: 1, publication_type: 'book/book chapter',
  reftitle: null, pubtitle: null, editors: null, pubvol: null, pubno: null, comments: null,
  pubyr: '1990', language: 'English', ...over,
});

// The migrated payload, as main() assembles it for a row.
function migrate(ref, refEditorsMap = noEditors) {
  const editors = buildEditors(ref, refEditorsMap);
  const pubType = mapPublicationType(ref, editors);
  const note = containerNote(ref, editors);
  return buildJsonb(
    ref, [{ familyName: 'Smith', givenName: 'J.' }], editors, pubType, null,
    mapPubtitle(ref, pubType.referenceTypeName), {}, 'English', note,
  );
}

const typeOf = (ref, map) => migrate(ref, map).publicationType;

// --- "book/book chapter" by title shape ---

test('book/book chapter with two titles is a chapter with its book title', () => {
  const jsonb = migrate(row({
    reftitle: 'A new toothed bird from China',
    pubtitle: 'Feathered Dinosaurs and the Origin of Flight',
  }));
  assert.equal(jsonb.publicationType, 'article in edited collection');
  assert.equal(jsonb.title, 'A new toothed bird from China');
  assert.equal(jsonb.bookTitle, 'Feathered Dinosaurs and the Origin of Flight');
  assert.equal(jsonb.bookType, undefined);
  assert.equal(jsonb.comments, undefined);
});

test('book/book chapter with only a pubtitle is a standalone monograph titled by it', () => {
  const jsonb = migrate(row({ reftitle: '  ', pubtitle: 'Acadian Geology' }));
  assert.equal(jsonb.publicationType, 'standalone book');
  assert.equal(jsonb.bookType, 'monograph');
  assert.equal(jsonb.title, 'Acadian Geology');
  assert.equal(jsonb.bookTitle, undefined);
});

test('book/book chapter with equal titles is a standalone monograph', () => {
  for (const [reftitle, pubtitle] of [
    ['Corals', 'Corals'],
    [' Corals ', 'Corals\t'],
    ['Cretaceous fossils of Queensland', 'Cretaceous Fossils of Queensland'],
  ]) {
    const jsonb = migrate(row({ reftitle, pubtitle }));
    assert.equal(jsonb.publicationType, 'standalone book');
    assert.equal(jsonb.bookType, 'monograph');
  }
});

test('book/book chapter with only a reftitle, or neither, is a standalone book', () => {
  assert.equal(typeOf(row({ reftitle: 'Corals' })), 'standalone book');
  const neither = migrate(row({ reftitle: '', pubtitle: '' }));
  assert.equal(neither.publicationType, 'standalone book');
  assert.equal(neither.title, undefined);
});

test('book/book chapter with one title and editors is a standalone book that keeps them', () => {
  const jsonb = migrate(row({ pubtitle: 'Whole', editors: 'Martin and Barnosky' }));
  assert.equal(jsonb.publicationType, 'standalone book');
  assert.equal(jsonb.bookType, 'monograph');
  assert.equal(jsonb.editors, 'Martin and Barnosky');
});

test('an edited collection target still takes its title from pubtitle', () => {
  assert.equal(mapTitle({ reftitle: null, pubtitle: ' Corals of the World ' }, 'edited collection'), 'Corals of the World');
  assert.equal(mapTitle({ reftitle: null, pubtitle: 'Corals of the World' }, 'other'), null);
});

test('hasTwoTitles trims and treats NULL as blank', () => {
  assert.equal(hasTwoTitles({ reftitle: ' a ', pubtitle: 'b' }), true);
  assert.equal(hasTwoTitles({ reftitle: 'a', pubtitle: null }), false);
  assert.equal(hasTwoTitles({ reftitle: ' A', pubtitle: 'a ' }), false);
});

// --- "book" by titles and editors ---

test('book with two titles and editors in the editors column is a chapter', () => {
  const jsonb = migrate(row({
    publication_type: 'book', reftitle: 'Chapter 7 - Devonian',
    pubtitle: 'The Geology of Pennsylvania', editors: 'C. H. Schultz',
  }));
  assert.equal(jsonb.publicationType, 'article in edited collection');
  assert.equal(jsonb.bookType, undefined);
  assert.equal(jsonb.bookTitle, 'The Geology of Pennsylvania');
  assert.equal(jsonb.editors, 'C. H. Schultz');
  assert.equal(jsonb.comments, undefined);
});

test('book with two titles and editors from ref_editors is a chapter', () => {
  const ref = row({ reference_no: 7, publication_type: 'book', reftitle: 'Part', pubtitle: 'Whole' });
  const map = new Map([[7, [{ firstname: 'L.', lastname: 'Agassiz' }]]]);
  const jsonb = migrate(ref, map);
  assert.equal(jsonb.publicationType, 'article in edited collection');
  assert.equal(jsonb.editors, 'L. Agassiz');
});

test('book with two titles and no editors stays a standalone monograph', () => {
  const jsonb = migrate(row({ publication_type: 'book', reftitle: 'Part', pubtitle: 'Whole', editors: '  ' }));
  assert.equal(jsonb.publicationType, 'standalone book');
  assert.equal(jsonb.bookType, 'monograph');
  assert.equal(jsonb.bookTitle, undefined);
});

test('book with one title stays a standalone monograph', () => {
  const jsonb = migrate(row({ publication_type: 'book', reftitle: 'Whole', editors: 'Someone' }));
  assert.equal(jsonb.publicationType, 'standalone book');
  assert.equal(jsonb.bookType, 'monograph');
});

// --- unaffected types ---

test('types outside the title rules keep their fixed mapping', () => {
  const two = { reftitle: 'Part', pubtitle: 'Whole', editors: 'Someone' };
  assert.equal(typeOf(row({ publication_type: 'book chapter', ...two })), 'article in edited collection');
  const article = migrate(row({ publication_type: 'journal article', ...two }));
  assert.equal(article.publicationType, 'journal article');
  assert.equal(article.journalTitle, 'Whole');
  const thesis = migrate(row({ publication_type: 'Ph.D. thesis', ...two }));
  assert.equal(thesis.publicationType, 'standalone book');
  assert.equal(thesis.bookType, 'Ph.D. thesis');
  assert.equal(thesis.comments, undefined);
  assert.equal(typeOf(row({ publication_type: null })), 'other');
});

// --- container note ---

const noted = (over) => row({ publication_type: 'book', reftitle: 'Part', ...over });

test('note with volume and number', () => {
  const jsonb = migrate(noted({
    pubtitle: 'Bulletin of the British Museum (Natural History), Zoology', pubvol: ' 18 ', pubno: '3',
  }));
  assert.equal(jsonb.comments, 'Published in: Bulletin of the British Museum (Natural History), Zoology, vol. 18, no. 3');
});

test('note with title only', () => {
  const jsonb = migrate(noted({ pubtitle: ' Monograph of the British Eocene Flora ', pubvol: ' ', pubno: '' }));
  assert.equal(jsonb.comments, 'Published in: Monograph of the British Eocene Flora');
});

test('note with volume only', () => {
  assert.equal(migrate(noted({ pubtitle: 'Palaeontographica', pubvol: '12' })).comments, 'Published in: Palaeontographica, vol. 12');
});

test('note follows existing comments', () => {
  const jsonb = migrate(noted({ pubtitle: "Annales du Musée d'Histoire Naturelle de Belgique", comments: ' 49 pl. ' }));
  assert.equal(jsonb.comments, "49 pl.; Published in: Annales du Musée d'Histoire Naturelle de Belgique");
});

test('no note on a reclassified chapter or a single-title book', () => {
  assert.equal(migrate(noted({ pubtitle: 'Whole', editors: 'Someone', comments: 'x' })).comments, 'x');
  assert.equal(migrate(noted({ pubtitle: 'Part' })).comments, undefined);
  assert.equal(migrate(row({ reftitle: 'Part', pubtitle: 'Whole', pubvol: '3' })).comments, undefined);
});

// --- single-title books review list ---

const noLookups = { bookTitles: new Set(), journalTitles: new Set() };
const people = (...names) => names.map((familyName) => ({ familyName, givenName: '' }));

// A ref's signals as main() computes them: authors, pages and lookups vary by case.
function signalsOf(over, { authors = people('Smith'), pages = null, lookups = noLookups } = {}) {
  const ref = row(over);
  const editors = buildEditors(ref, noEditors);
  const pubType = mapPublicationType(ref, editors);
  const jsonb = buildJsonb(ref, authors, editors, pubType, pages, mapPubtitle(ref, pubType.referenceTypeName), {}, 'English');
  return reviewSignals(ref, jsonb, editors, lookups);
}

test('review group: single-title book/book chapter refs, and single-title book refs with editors', () => {
  assert.equal(inReviewGroup(row({ pubtitle: 'Whole' }), null), true);
  assert.equal(inReviewGroup(row({ reftitle: 'Part', pubtitle: 'Whole' }), null), false);
  assert.equal(inReviewGroup(row({ publication_type: 'book', reftitle: 'Whole' }), 'Someone'), true);
  assert.equal(inReviewGroup(row({ publication_type: 'book', reftitle: 'Whole' }), null), false);
  assert.equal(inReviewGroup(row({ publication_type: 'book', reftitle: 'Part', pubtitle: 'Whole' }), 'Someone'), false);
  assert.equal(inReviewGroup(row({ publication_type: 'book chapter', reftitle: 'Whole' }), 'Someone'), false);
});

test('chapter-missing-title: editors with a blank title or one starting "in "', () => {
  assert.deepEqual(signalsOf({ editors: 'Biggs' }), ['chapter-missing-title']);
  assert.deepEqual(signalsOf({ pubtitle: 'in Bering Land Bridge', editors: 'Hopkins' }), ['chapter-missing-title']);
  assert.deepEqual(signalsOf({ pubtitle: 'In: Anthropoid Origins', editors: 'Fleagle' }), ['chapter-missing-title']);
  assert.deepEqual(signalsOf({ pubtitle: 'in Bering Land Bridge' }), []);
  assert.deepEqual(signalsOf({ pubtitle: 'Insects of the Coal Measures', editors: 'Someone' }), []);
});

test('multi-author-no-editors: two or more authors and no editors', () => {
  assert.deepEqual(signalsOf({ pubtitle: 'Whole' }, { authors: people('Fraser', 'Sues') }), ['multi-author-no-editors']);
  assert.deepEqual(signalsOf({ pubtitle: 'Whole', editors: 'X' }, { authors: people('Fraser', 'Sues') }), []);
});

test('pubtitle-is-book-title and pubtitle-is-journal-title compare trimmed and lowercased', () => {
  const lookups = { bookTitles: new Set(['crato fossil beds of brazil']), journalTitles: new Set(['neues jahrbuch']) };
  assert.deepEqual(signalsOf({ pubtitle: ' Crato Fossil Beds of Brazil ' }, { lookups }), ['pubtitle-is-book-title']);
  assert.deepEqual(signalsOf({ pubtitle: 'Neues Jahrbuch' }, { lookups }), ['pubtitle-is-journal-title']);
  assert.deepEqual(signalsOf({ reftitle: 'Neues Jahrbuch' }, { lookups }), []);
});

test('first-page-after-1: numeric first page above 1', () => {
  assert.deepEqual(signalsOf({ pubtitle: 'Whole' }, { pages: { first: 241, last: 300 } }), ['first-page-after-1']);
  assert.deepEqual(signalsOf({ pubtitle: 'Whole' }, { pages: { first: 1, last: 300 } }), []);
});

test('edited-volume-words: volume words in the title, editor words in the title or comments', () => {
  assert.deepEqual(signalsOf({ pubtitle: 'Proceedings of the Third Symposium' }), ['edited-volume-words']);
  assert.deepEqual(signalsOf({ pubtitle: 'A volume in honour of W. D. Lang' }), ['edited-volume-words']);
  assert.deepEqual(signalsOf({ pubtitle: 'Whole', comments: 'R. Smith, ed.' }), ['edited-volume-words']);
  assert.deepEqual(signalsOf({ pubtitle: 'Edited by the Society' }), ['edited-volume-words']);
  assert.deepEqual(signalsOf({ pubtitle: 'Reduced faunas', comments: 'Credited to Jones' }), []);
});

test('book-with-editors: every single-title book with editors, and only those', () => {
  const tortoises = {
    publication_type: 'book', reftitle: 'The Conservation Biology of Tortoises',
    editors: 'I. R. Swingland, M. W. Klemens',
  };
  assert.deepEqual(signalsOf(tortoises, { authors: people('Swingland', 'Klemens') }), ['book-with-editors']);
  assert.equal(migrate(row(tortoises)).publicationType, 'standalone book');
  assert.deepEqual(signalsOf({ publication_type: 'book', reftitle: 'Proceedings' }, { authors: people('A', 'B') }), []);
});

test('several signals come in spec order; a plain authored book has none', () => {
  const lookups = { bookTitles: new Set(['whole']), journalTitles: new Set() };
  assert.deepEqual(
    signalsOf({ pubtitle: 'Whole' }, { authors: people('Fraser', 'Sues'), lookups }),
    ['multi-author-no-editors', 'pubtitle-is-book-title'],
  );
  assert.deepEqual(signalsOf({ pubtitle: 'Die vorzeitlichen Saugetiere' }, { pages: { first: 1, last: 309 } }), []);
});

test('refs outside the review group yield no signals', () => {
  const two = { reftitle: 'Proceedings', pubtitle: 'Whole', editors: 'X' };
  assert.deepEqual(signalsOf(two, { authors: people('A', 'B') }), []);
  assert.deepEqual(signalsOf({ ...two, publication_type: 'journal article' }), []);
});

test('review rows: columns, quoting, non-ASCII text and pages', () => {
  const ref = row({ reference_no: 36067, pubtitle: 'Paléontologie française: Terrains crétacés, 1', firstpage: '1', lastpage: '662' });
  const jsonb = { title: 'Paléontologie française: Terrains crétacés, 1', authors: people("d'Orbigny"), publicationYear: '1841', pages: { first: 1, last: 662 } };
  assert.equal(
    reviewRow(ref, jsonb, 'REF-36067-47', ['edited-volume-words']),
    '36067,REF-36067-47,book/book chapter,d\'Orbigny,,1841,"Paléontologie française: Terrains crétacés, 1",1–662,edited-volume-words',
  );

  const odd = row({ reference_no: 3343, publication_type: 'book', firstpage: 'xii', lastpage: 'xx' });
  const oddJsonb = { authors: people('Swinehart', 'Diffendal, Jr.'), editors: 'Biggs', title: 'A "quoted"\nline' };
  assert.equal(
    reviewRow(odd, oddJsonb, 'REF-3343-11', ['chapter-missing-title', 'book-with-editors']),
    '3343,REF-3343-11,book,"Swinehart; Diffendal, Jr.",Biggs,,"A ""quoted""\nline",xii–xx,chapter-missing-title; book-with-editors',
  );

  const blank = reviewRow(row({ reference_no: 2 }), {}, 'REF-2-00', ['chapter-missing-title']);
  assert.equal(blank, '2,REF-2-00,book/book chapter,,,,,,chapter-missing-title');
});

// --- db variant ---

test('reclassified chapters, single-title books and noted books validate against the reference db variant', () => {
  const enums = new Map([
    ['languages.name', ['English', 'other', 'unknown']],
    ['book_types.name', ['monograph', 'compendium', 'Ph.D. thesis', 'M.S. thesis', 'guidebook']],
  ]);
  const validate = createAjv().compile(deriveVariant(applyEnums(referenceSource, enums), 'db'));
  const cases = [
    row({ reftitle: 'Part', pubtitle: 'Whole' }),
    noted({ pubtitle: 'Whole', editors: 'Someone' }),
    noted({ pubtitle: 'Whole', pubvol: '18', pubno: '3', comments: '49 pl.' }),
    row({ pubtitle: 'Acadian Geology' }),
    row({ pubtitle: 'Whole', editors: 'Martin and Barnosky' }),
    row({ editors: 'Biggs' }),
  ];
  for (const ref of cases) {
    const jsonb = migrate(ref);
    assert.ok(validate(jsonb), JSON.stringify(validate.errors));
  }
});
