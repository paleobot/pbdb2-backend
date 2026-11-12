import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasTwoTitles, mapPublicationType, mapPubtitle, buildEditors, containerNote, buildJsonb,
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

test('book/book chapter with only a pubtitle stays an edited collection titled by it', () => {
  const jsonb = migrate(row({ reftitle: '  ', pubtitle: 'Corals of the World' }));
  assert.equal(jsonb.publicationType, 'edited collection');
  assert.equal(jsonb.title, 'Corals of the World');
  assert.equal(jsonb.bookTitle, undefined);
});

test('book/book chapter with equal titles stays an edited collection', () => {
  assert.equal(typeOf(row({ reftitle: 'Corals', pubtitle: 'Corals' })), 'edited collection');
  assert.equal(typeOf(row({ reftitle: ' Corals ', pubtitle: 'Corals\t' })), 'edited collection');
  assert.equal(
    typeOf(row({ reftitle: 'Cretaceous fossils of Queensland', pubtitle: 'Cretaceous Fossils of Queensland' })),
    'edited collection',
  );
});

test('book/book chapter with only a reftitle, or neither, stays an edited collection', () => {
  assert.equal(typeOf(row({ reftitle: 'Corals' })), 'edited collection');
  assert.equal(typeOf(row({ reftitle: '', pubtitle: '' })), 'edited collection');
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

// --- db variant ---

test('reclassified chapters and noted books validate against the reference db variant', () => {
  const enums = new Map([
    ['languages.name', ['English', 'other', 'unknown']],
    ['book_types.name', ['monograph', 'compendium', 'Ph.D. thesis', 'M.S. thesis', 'guidebook']],
  ]);
  const validate = createAjv().compile(deriveVariant(applyEnums(referenceSource, enums), 'db'));
  const cases = [
    row({ reftitle: 'Part', pubtitle: 'Whole' }),
    noted({ pubtitle: 'Whole', editors: 'Someone' }),
    noted({ pubtitle: 'Whole', pubvol: '18', pubno: '3', comments: '49 pl.' }),
  ];
  for (const ref of cases) {
    const jsonb = migrate(ref);
    assert.ok(validate(jsonb), JSON.stringify(validate.errors));
  }
});
