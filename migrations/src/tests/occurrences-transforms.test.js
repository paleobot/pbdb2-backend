import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isUnset, buildIdentificationPayload, buildAbundancePayload, hasAbundance,
} from '../occurrences-migration/migrate-occurrences.js';
import { identificationSource } from '../../../payloadSchemas/identification.schema.js';
import { occurrenceAbundanceSource } from '../../../payloadSchemas/occurrenceAbundance.schema.js';
import { deriveVariant } from '../../../payloadSchemas/lib/variants.js';
import { createAjv } from '../../../payloadSchemas/lib/ajv.js';

// Neither source declares x-enumFrom, so the db variants need no dictionary.
const ajv = createAjv();
const validIdentification = ajv.compile(deriveVariant(identificationSource, 'db'));
const validAbundance = ajv.compile(deriveVariant(occurrenceAbundanceSource, 'db'));

// An occurrence row with every column the script reads; overrides fill the case.
const occ = (over) => ({
  occurrence_no: 12345, collection_no: 10, reference_no: 20, taxon_no: 30, authorizer_no: 4, enterer_no: 4,
  genus_reso: '', genus_name: 'Acrodus', subgenus_reso: null, subgenus_name: null,
  species_reso: '', species_name: 'sp.', subspecies_reso: null, subspecies_name: null,
  plant_organ: '', plant_organ2: '', abund_value: null, abund_unit: null, comments: null, ...over,
});
const reid = (over) => ({ ...occ({ plant_organ2: undefined, abund_value: undefined, abund_unit: undefined }), reid_no: 7, ...over });

const built = [];
const identification = (src, opts) => {
  const p = buildIdentificationPayload(src, opts);
  built.push(['identification', p]);
  return p;
};
const abundance = (src) => {
  const p = buildAbundancePayload(src);
  built.push(['abundance', p]);
  return p;
};

test('0 and NULL are both unset', () => {
  assert.equal(isUnset(0), true);
  assert.equal(isUnset(null), true);
  assert.equal(isUnset(undefined), true);
  assert.equal(isUnset('0'), true);
  assert.equal(isUnset(5), false);
});

test("'' and NULL resolutions and names are omitted; the ditto mark is kept", () => {
  const p = identification(occ({ genus_reso: '', genus_name: 'Acrodus', species_reso: '"', species_name: 'minimus' }));
  assert.deepEqual(p.identification.genus, { name: 'Acrodus' });
  assert.deepEqual(p.identification.species, { resolution: '"', name: 'minimus' });
});

test('a rank with neither resolution nor name is omitted', () => {
  const p = identification(occ({ subgenus_reso: '', subgenus_name: '', subspecies_reso: null, subspecies_name: null }));
  assert.deepEqual(Object.keys(p.identification), ['genus', 'species']);
});

test('a row with no name at all has no identification block', () => {
  const p = identification(occ({ genus_name: '', species_name: '' }));
  assert.equal('identification' in p, false);
});

test('plant_organ comes before plant_organ2; blanks are dropped', () => {
  assert.deepEqual(identification(occ({ plant_organ: 'leaf', plant_organ2: 'seed/fruit' })).plantOrgans, ['leaf', 'seed/fruit']);
  assert.deepEqual(identification(occ({ plant_organ: '', plant_organ2: 'wood' })).plantOrgans, ['wood']);
  assert.equal('plantOrgans' in identification(occ({ plant_organ: '', plant_organ2: null })), false);
});

test('an occurrence carries oldpbdbID only', () => {
  assert.deepEqual(identification(occ()).legacyIDs, { oldpbdbID: '12345' });
});

test('a reidentification carries both legacy numbers as strings and no second organ', () => {
  const p = identification(reid({ plant_organ: 'axis', plant_organ2: 'leaf' }), { reid: true });
  assert.deepEqual(p.legacyIDs, { oldpbdbID: '12345', oldpbdbReidID: '7' });
  assert.deepEqual(p.plantOrgans, ['axis']);
});

test('NUL bytes are stripped and comments trimmed; empty comments are omitted', () => {
  assert.equal(identification(occ({ comments: 'a\u0000b ' })).comments, 'ab');
  assert.equal('comments' in identification(occ({ comments: ' \u0000 ' })), false);
});

test('extra resolutions per rank are accepted', () => {
  identification(occ({ genus_reso: 'n. gen.', species_reso: 'n. sp.', subspecies_reso: 'var', subspecies_name: 'x' }));
});

test('abundance: unit without value is kept, both stay text, blanks omitted', () => {
  const src = occ({ abund_value: '', abund_unit: 'specimens' });
  assert.equal(hasAbundance(src), true);
  assert.deepEqual(abundance(src), { legacyIDs: { oldpbdbID: '12345' }, unit: 'specimens' });
  assert.deepEqual(abundance(occ({ abund_value: ' 3-5 ', abund_unit: 'individuals' })),
    { legacyIDs: { oldpbdbID: '12345' }, value: '3-5', unit: 'individuals' });
  assert.equal(hasAbundance(occ({ abund_value: ' ', abund_unit: null })), false);
});

test('every payload built above is valid against its db variant', () => {
  assert.ok(built.length > 10);
  for (const [kind, p] of built) {
    const validate = kind === 'identification' ? validIdentification : validAbundance;
    assert.ok(validate(p), `${kind} ${JSON.stringify(p)}: ${JSON.stringify(validate.errors)}`);
  }
});

test('an unknown resolution is rejected by the db variant', () => {
  assert.equal(validIdentification(buildIdentificationPayload(occ({ genus_reso: 'maybe' }))), false);
});
