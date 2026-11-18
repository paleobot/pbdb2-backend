import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasTwoTitles, mapPublicationType, mapPubtitle, mapVolNo, mapTitle, buildEditors, containerNote, buildJsonb,
  inReviewGroup, reviewSignals, reviewRow, doiFor, journalTitleCounts, journalShare, untypedReviewRow, noteForm,
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
function migrate(ref, refEditorsMap = noEditors, journalTitles = new Map()) {
  const editors = buildEditors(ref, refEditorsMap);
  const pubType = mapPublicationType(ref, editors, journalTitles);
  return buildJsonb(
    ref, [{ familyName: 'Smith', givenName: 'J.' }], editors, pubType, null,
    mapPubtitle(ref, pubType.referenceTypeName), mapVolNo(ref, pubType.referenceTypeName), 'English',
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
  assert.equal(thesis.comments, 'Source: Whole');
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

test('no note on a reclassified chapter without volume or a single-title book', () => {
  assert.equal(migrate(noted({ pubtitle: 'Whole', editors: 'Someone', comments: 'x' })).comments, 'x');
  assert.equal(migrate(noted({ pubtitle: 'Part' })).comments, undefined);
});

// A Classic "book chapter": always an article in edited collection.
const chapter = (over) => row({ publication_type: 'book chapter', reftitle: 'Part', ...over });

test('chapter with a volume: note repeats the whole pubtitle, which stays in bookTitle', () => {
  const pubtitle = 'The Continental Jurassic. Museum of Northern Arizona Bulletin';
  const jsonb = migrate(chapter({ pubtitle, pubvol: '60' }));
  assert.equal(jsonb.publicationType, 'article in edited collection');
  assert.equal(jsonb.bookTitle, pubtitle);
  assert.equal(jsonb.comments, `Published in: ${pubtitle}, vol. 60`);
  assert.equal(jsonb.journalVolume, undefined);
  assert.equal(jsonb.seriesVolume, undefined);
  assert.equal(jsonb.journalNumber, undefined);
});

test('chapter with a number only', () => {
  assert.equal(migrate(chapter({ pubtitle: 'Whole', pubno: '2' })).comments, 'Published in: Whole, no. 2');
});

test('chapter with volume and number, trimmed', () => {
  assert.equal(
    migrate(chapter({ pubtitle: ' Whole ', pubvol: ' 18 ', pubno: '3\t' })).comments,
    'Published in: Whole, vol. 18, no. 3',
  );
});

test('chapter note follows existing comments', () => {
  assert.equal(
    migrate(chapter({ pubtitle: 'Whole', pubvol: '21', comments: ' pl. 3 ' })).comments,
    'pl. 3; Published in: Whole, vol. 21',
  );
});

test('chapter with a volume but no pubtitle', () => {
  const jsonb = migrate(chapter({ pubtitle: ' ', pubvol: '3', pubno: '2' }));
  assert.equal(jsonb.publicationType, 'article in edited collection');
  assert.equal(jsonb.comments, 'Published in: vol. 3, no. 2');
  assert.equal(jsonb.bookTitle, undefined);
});

test('chapters by the title rules get a note', () => {
  for (const ref of [
    row({ reftitle: 'Part', pubtitle: 'Whole', pubvol: '14' }),
    row({ publication_type: 'book', reftitle: 'Part', pubtitle: 'Whole', editors: 'Someone', pubvol: '14' }),
  ]) {
    const jsonb = migrate(ref);
    assert.equal(jsonb.publicationType, 'article in edited collection');
    assert.equal(jsonb.bookTitle, 'Whole');
    assert.equal(jsonb.comments, 'Published in: Whole, vol. 14');
  }
});

test('chapter without volume or number gets no note', () => {
  const jsonb = migrate(chapter({ pubtitle: 'Whole', pubvol: ' ', pubno: '', comments: 'x' }));
  assert.equal(jsonb.bookTitle, 'Whole');
  assert.equal(jsonb.comments, 'x');
  assert.equal(migrate(chapter({ pubtitle: 'Whole' })).comments, undefined);
});

test('journal articles and serial monographs hold their volume; a whole book notes its own', () => {
  const vol = { reftitle: 'Part', pubtitle: 'Whole', pubvol: '42', pubno: '3' };
  const article = migrate(row({ publication_type: 'journal article', ...vol }));
  assert.equal(article.comments, undefined);
  assert.equal(article.journalVolume, '42');
  const serial = migrate(row({ publication_type: 'serial monograph', ...vol }));
  assert.equal(serial.publicationType, 'serial monograph');
  assert.equal(serial.comments, undefined);
  assert.equal(serial.seriesVolume, '42');
  assert.equal(serial.seriesNumber, '3');
  const single = migrate(row({ pubtitle: 'Acadian Geology', pubvol: '2' }));
  assert.equal(single.publicationType, 'standalone book');
  assert.equal(single.comments, 'Published as vol. 2');
});

// --- untyped refs ---

const typed = (publication_type, pubtitle, n = 1) =>
  Array.from({ length: n }, () => ({ publication_type, pubtitle }));
const untyped = (over) => row({ publication_type: null, reftitle: 'An article', ...over });

test('journalTitleCounts counts typed refs by trimmed lowercased pubtitle', () => {
  const counts = journalTitleCounts([
    ...typed('journal article', ' Nature '), ...typed('journal article', 'NATURE'), ...typed('serial monograph', 'nature'),
    ...typed(null, 'Nature', 5), ...typed('journal article', '  '), ...typed('journal article', null),
  ]);
  assert.deepEqual([...counts], [['nature', { journal: 2, typed: 3 }]]);
});

test('untyped ref with a journal majority is a journal article with its journal fields', () => {
  const titles = journalTitleCounts([...typed('journal article', 'Nature', 2), ...typed('book', 'Nature')]);
  const jsonb = migrate(untyped({ pubtitle: ' nature ', pubvol: '316', pubno: '6' }), noEditors, titles);
  assert.equal(jsonb.publicationType, 'journal article');
  assert.equal(jsonb.journalTitle, 'nature');
  assert.equal(jsonb.journalVolume, '316');
  assert.equal(jsonb.journalNumber, '6');
  assert.equal(jsonb.comments, undefined);
});

test('untyped ref whose title is mostly a series stays other with a note', () => {
  const usgs = 'United States Geological Survey Professional Paper';
  const titles = journalTitleCounts([...typed('journal article', usgs, 153), ...typed('serial monograph', usgs, 183)]);
  const jsonb = migrate(untyped({ pubtitle: usgs, pubvol: '450' }), noEditors, titles);
  assert.equal(jsonb.publicationType, 'other');
  assert.equal(jsonb.journalTitle, undefined);
  assert.equal(jsonb.comments, `Published in: ${usgs}, vol. 450`);
});

test('exactly half is not a majority', () => {
  const titles = journalTitleCounts([...typed('journal article', 'Mixed'), ...typed('serial monograph', 'Mixed')]);
  assert.equal(migrate(untyped({ pubtitle: 'Mixed' }), noEditors, titles).publicationType, 'other');
});

test('untyped ref with a blank or unmatched pubtitle stays other', () => {
  const titles = journalTitleCounts(typed('journal article', 'Nature'));
  assert.equal(migrate(untyped({ pubtitle: '  ' }), noEditors, titles).publicationType, 'other');
  assert.equal(migrate(untyped({ pubtitle: 'Unknown Gazette' }), noEditors, titles).publicationType, 'other');
});

test('untyped refs do not vote', () => {
  const titles = journalTitleCounts([...typed(null, 'Bulletin X', 10), ...typed('serial monograph', 'Bulletin X')]);
  assert.equal(migrate(untyped({ pubtitle: 'Bulletin X' }), noEditors, titles).publicationType, 'other');
});

test('a typed ref is never retyped by the untyped rule', () => {
  const titles = journalTitleCounts(typed('journal article', 'Nature', 5));
  assert.equal(migrate(row({ publication_type: 'abstract', pubtitle: 'Nature' }), noEditors, titles).publicationType, 'other');
});

// --- the general container note ---

test('abstract keeps its venue', () => {
  const jsonb = migrate(row({
    publication_type: 'abstract', reftitle: 'Emsian brachiopods',
    pubtitle: 'Geological Society of America Abstracts with Programs', pubvol: '29',
  }));
  assert.equal(jsonb.publicationType, 'other');
  assert.equal(jsonb.comments, 'Published in: Geological Society of America Abstracts with Programs, vol. 29');
});

test('untyped ref left other keeps its container', () => {
  const jsonb = migrate(untyped({ pubtitle: 'Geologisches Jahrbuch, Beihefte', pubvol: '85' }));
  assert.equal(jsonb.comments, 'Published in: Geologisches Jahrbuch, Beihefte, vol. 85');
});

test('other with a volume but no pubtitle', () => {
  assert.equal(migrate(row({ publication_type: 'abstract', reftitle: 'A', pubvol: '7' })).comments, 'Published in: vol. 7');
});

test('thesis source', () => {
  const jsonb = migrate(row({
    publication_type: 'Ph.D. thesis',
    reftitle: 'Anatomy, phylogeny, and palaeoecology of the basal thalattosuchians (Mesoeucrocodylia) from the Liassic of Central Europe',
    pubtitle: 'PhD dissertation, Johannes Gutenberg-Universität Mainz',
  }));
  assert.equal(jsonb.comments, 'Source: PhD dissertation, Johannes Gutenberg-Universität Mainz');
});

test('unpublished source follows existing comments', () => {
  const jsonb = migrate(row({ publication_type: 'unpublished', reftitle: 'Data', pubtitle: 'pers. comm.', comments: 'Primary collection data' }));
  assert.equal(jsonb.comments, 'Primary collection data; Source: pers. comm.');
});

test('compendium source with a volume and number', () => {
  const jsonb = migrate(row({
    publication_type: 'compendium', reftitle: 'Available generic names for trilobites',
    pubtitle: 'Memoirs of the Queensland Museum', pubvol: '48', pubno: '2',
  }));
  assert.equal(jsonb.comments, 'Source: Memoirs of the Queensland Museum, vol. 48, no. 2');
});

test('guidebook in a field-conference volume', () => {
  const jsonb = migrate(row({
    publication_type: 'guidebook', reftitle: 'Guide to the Late Pennsylvanian paleontology of the Upper Madera Formation',
    pubtitle: 'New Mexico Geological Society Guidebook', pubvol: '47',
  }));
  assert.equal(jsonb.comments, 'Published in: New Mexico Geological Society Guidebook, vol. 47');
});

test('whole book with its own volume', () => {
  const jsonb = migrate(row({ publication_type: 'book', reftitle: '', pubtitle: 'Die Saugetiere', pubvol: 'II' }));
  assert.equal(jsonb.publicationType, 'standalone book');
  assert.equal(jsonb.title, 'Die Saugetiere');
  assert.equal(jsonb.comments, 'Published as vol. II');
});

test('own title is not repeated', () => {
  assert.equal(migrate(row({ reftitle: 'Corals', pubtitle: 'CORALS', pubvol: '2' })).comments, 'Published as vol. 2');
});

test('single-title book without a volume gets no note', () => {
  assert.equal(migrate(row({ pubtitle: 'Acadian Geology', comments: 'x' })).comments, 'x');
  assert.equal(migrate(row({ reftitle: 'Corals', pubtitle: 'corals' })).comments, undefined);
});

test('noteForm names each prefix', () => {
  assert.equal(noteForm('Source: x'), 'Source');
  assert.equal(noteForm('Published in: x'), 'Published in');
  assert.equal(noteForm('Published as vol. 2'), 'Published as');
});

// Every value is held by a field or listed in the note, and only chapters list a
// container value a field also holds.
test('held invariant: nothing is dropped, nothing but a chapter book title is both stored and noted', () => {
  const types = [null, 'journal article', 'serial monograph', 'unpublished', 'book/book chapter', 'book chapter', 'book',
    'compendium', 'Ph.D. thesis', 'M.S. thesis', 'guidebook', 'news article', 'abstract', 'instcoll'];
  const titles = journalTitleCounts(typed('journal article', 'Whole'));
  const shapes = [
    { reftitle: 'Part', pubtitle: 'Whole' }, { reftitle: '', pubtitle: 'Whole' }, { reftitle: 'Whole', pubtitle: 'whole' },
    { reftitle: 'Part', pubtitle: '' },
  ];
  for (const publication_type of types) {
    for (const shape of shapes) {
      for (const [pubvol, pubno] of [['', ''], ['12', ''], ['', '3'], ['12', '3']]) {
        for (const editors of [null, 'Someone']) {
          const ref = row({ publication_type, editors, pubvol, pubno, ...shape });
          const jsonb = migrate(ref, noEditors, titles);
          const note = containerNote(ref, jsonb) ?? '';
          const where = `${publication_type} ${JSON.stringify(shape)} vol=${pubvol} no=${pubno} ed=${editors}`;
          const fields = Object.entries(jsonb).filter(([k]) => k !== 'comments' && k !== 'publicationType').map(([, v]) => v);
          const own = shape.pubtitle && shape.pubtitle.toLowerCase() === (jsonb.title ?? '').toLowerCase();
          if (shape.pubtitle && !own) assert.ok(fields.includes(shape.pubtitle) || note.includes(shape.pubtitle), `pubtitle lost: ${where}`);
          for (const [value, label] of [[pubvol, 'vol.'], [pubno, 'no.']]) {
            if (!value) continue;
            const inField = fields.includes(value);
            const inNote = note.includes(`${label} ${value}`);
            assert.ok(inField !== inNote, `${label} ${value} must be in exactly one place: ${where}`);
          }
          if (note && jsonb.publicationType !== 'article in edited collection') {
            for (const k of ['journalTitle', 'seriesTitle']) assert.ok(!jsonb[k] || !note.includes(jsonb[k]), `${k} repeated: ${where}`);
          }
        }
      }
    }
  }
});

test('serial monograph number goes to seriesNumber, not the note', () => {
  const jsonb = migrate(row({ publication_type: 'serial monograph', reftitle: 'T', pubtitle: 'Bulletin AMNH', pubvol: '105', pubno: '3' }));
  assert.equal(jsonb.seriesTitle, 'Bulletin AMNH');
  assert.equal(jsonb.seriesVolume, '105');
  assert.equal(jsonb.seriesNumber, '3');
  assert.equal(jsonb.comments, undefined);
});

// --- untyped refs review list ---

test('journal share: counts for the pubtitle, blank when no typed ref has it', () => {
  const titles = journalTitleCounts([
    ...typed('journal article', 'Annals of the South African Museum', 111), ...typed('serial monograph', 'Annals of the South African Museum', 3),
  ]);
  assert.equal(journalShare(untyped({ pubtitle: ' annals of the south african museum ' }), titles), '111/114');
  assert.equal(journalShare(untyped({ pubtitle: 'Nowhere' }), titles), '');
  assert.equal(journalShare(untyped({ pubtitle: null }), titles), '');
});

test('untyped review rows: columns in order, quoting and trimming', () => {
  const titles = journalTitleCounts(typed('journal article', 'C. R. Acad. Sci. Paris, Série II'));
  const ref = untyped({ reference_no: 7, pubtitle: ' C. R. Acad. Sci. Paris, Série II ', pubvol: ' 316 ', pubno: '' });
  const jsonb = { publicationType: 'journal article', authors: people('Dupont', 'Martin'), publicationYear: '1993', title: 'Nouvelle découverte' };
  assert.equal(untypedReviewRow(ref, jsonb, 'REF-7-00', titles),
    '7,REF-7-00,journal article,1/1,Dupont; Martin,1993,Nouvelle découverte,"C. R. Acad. Sci. Paris, Série II",316,');
  assert.equal(untypedReviewRow(untyped({ reference_no: 8 }), { publicationType: 'other' }, 'REF-8-00', titles),
    '8,REF-8-00,other,,,,,,,');
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
    chapter({ pubtitle: 'Whole', pubvol: '60', comments: 'pl. 3' }),
    chapter({ pubvol: '3', pubno: '2' }),
    row({ publication_type: 'serial monograph', reftitle: 'T', pubtitle: 'Bulletin', pubvol: '105', pubno: '3' }),
    row({ publication_type: 'abstract', reftitle: 'A', pubtitle: 'JVP', pubvol: '26', comments: 'suppl.' }),
    row({ publication_type: 'Ph.D. thesis', reftitle: 'T', pubtitle: 'PhD thesis, Yale' }),
  ];
  for (const ref of cases) {
    const jsonb = migrate(ref);
    assert.ok(validate(jsonb), JSON.stringify(validate.errors));
  }
  const untypedJournal = migrate(row({ publication_type: null, reftitle: 'T', pubtitle: 'Nature', pubvol: '1', pubno: '2' }),
    noEditors, journalTitleCounts(typed('journal article', 'Nature')));
  assert.equal(untypedJournal.publicationType, 'journal article');
  assert.ok(validate(untypedJournal), JSON.stringify(validate.errors));
});

// --- DOIs ---

const vrow = (source_doi, verdict) => ({ source_doi, verdict });

test('doiFor: a prefixed DOI with a current match is stored normalized', () => {
  const ref = row({ doi: 'doi:10.1017/S0022336000020096' });
  assert.deepEqual(doiFor(ref, vrow('doi:10.1017/S0022336000020096', 'match')),
    { doi: '10.1017/S0022336000020096', outcome: 'match' });
});

test('doiFor: dropped verdicts store nothing', () => {
  for (const verdict of ['wrong', 'related-work', 'unresolvable']) {
    assert.deepEqual(doiFor(row({ doi: '10.1/x' }), vrow('10.1/x', verdict)), { doi: null, outcome: verdict });
  }
  const jstor = 'http://www.jstor.org/stable/1302950';
  assert.deepEqual(doiFor(row({ doi: jstor }), vrow(jstor, 'malformed')), { doi: null, outcome: 'malformed' });
});

test('doiFor: uncertain and part-or-container are kept', () => {
  for (const verdict of ['uncertain', 'part-or-container']) {
    assert.equal(doiFor(row({ doi: ' 10.1/x ' }), vrow('10.1/x', verdict)).doi, '10.1/x');
  }
});

test('doiFor: no row or a stale row is unaudited', () => {
  assert.deepEqual(doiFor(row({ doi: '10.1234/new.2026' }), undefined), { doi: '10.1234/new.2026', outcome: 'unaudited' });
  assert.deepEqual(doiFor(row({ doi: '10.1111/new' }), vrow('10.1111/old', 'wrong')), { doi: '10.1111/new', outcome: 'unaudited' });
  assert.deepEqual(doiFor(row({ doi: '-' }), undefined), { doi: null, outcome: 'unaudited-malformed' });
});

test('doiFor: a blank DOI has no outcome', () => {
  assert.deepEqual(doiFor(row({ doi: null }), undefined), { doi: null, outcome: null });
  assert.deepEqual(doiFor(row({ doi: '  ' }), undefined), { doi: null, outcome: null });
});

test('buildJsonb stores the given DOI, and omits it when null', () => {
  const ref = row({ publication_type: 'journal article', reftitle: 'T', doi: 'doi:10.1/x' });
  const pubType = mapPublicationType(ref, null);
  const build = (doi) => buildJsonb(ref, [], null, pubType, null, {}, {}, 'English', doi);
  assert.equal(build('10.1/x').doi, '10.1/x');
  assert.ok(!('doi' in build(null)));
});
