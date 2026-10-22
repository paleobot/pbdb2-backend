import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Validator } from '@seriousme/openapi-schema-validator';

import { build } from '../src/app.js';
import { publishedComponents } from '../src/lib/published-schemas.js';
import { referenceSource } from '../../payloadSchemas/reference.schema.js';
import { assertPublished } from './published.js';

/**
 * The API description (api-description): an OpenAPI 3.1 document generated
 * from the route schemas. Built with no database, as `npm test` runs, so the
 * document checked here is the one a deployment serves.
 */

let app;
let doc;

before(async () => {
  app = build();
  const res = await app.inject({ method: 'GET', url: '/api/v1/openapi.json' });
  assert.equal(res.statusCode, 200);
  doc = res.json();
});
after(() => app.close());

const RESOURCES = ['authorities', 'collections', 'references', 'schemas', 'taxa'];

test('the document is valid OpenAPI 3.1 and is not enveloped', async () => {
  assert.match(doc.openapi, /^3\.1\./);
  const result = await new Validator().validate(doc);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  for (const key of ['data', 'meta', 'links']) assert.equal(key in doc, false, key);
});

test('its paths are exactly the GET operations discovery reaches, single reads included', async () => {
  const reached = new Set();
  const walk = async (path) => {
    reached.add(path);
    const { data } = (await app.inject({ method: 'GET', url: path })).json();
    for (const { href } of Object.values(data.resources)) {
      const child = new URL(href).pathname;
      if (RESOURCES.includes(child.split('/').pop())) {
        reached.add(child).add(`${child}/{permid}`);
      } else {
        await walk(child);
      }
    }
  };
  await walk('/');

  assert.deepEqual(Object.keys(doc.paths).sort(), [...reached].sort());
  for (const [path, operations] of Object.entries(doc.paths)) {
    assert.deepEqual(Object.keys(operations), ['get'], `${path}: GET only`);
    assert.ok(operations.get.responses['200'], `${path}: describes its 200`);
  }
  assert.equal(Object.keys(doc.paths).some((p) => p.includes('specimens')), false);
});

test('a list documents its filters and bounds; an expansion is a boolean', () => {
  const params = Object.fromEntries(doc.paths['/api/v1/references'].get.parameters.map((p) => [p.name, p]));
  assert.deepEqual(Object.keys(params), ['ids', 'limit', 'cursor', 'publicationType']);
  assert.deepEqual(params.publicationType.schema.enum, referenceSource.properties.publicationType.enum);
  assert.equal(params.limit.schema.type, 'integer');
  assert.equal(params.limit.schema.minimum, 1);
  assert.equal(params.limit.schema.maximum, 1000);
  assert.match(params.ids.description, /100/);
  assert.match(params.ids.description, /`limit` or `cursor`/);
  assert.match(params.cursor.description, /links\.next/);

  const taxa = doc.paths['/api/v1/taxa'].get.parameters.find((p) => p.name === 'includeContainingTaxa');
  assert.equal(taxa.schema.type, 'boolean');
});

test('storage does not leak into the document', () => {
  const text = JSON.stringify(doc);
  const keys = new Set();
  JSON.parse(text, (key, value) => { keys.add(key); return value; });
  assert.deepEqual([...keys].filter((k) => k.startsWith('x-')), []);
  assert.equal(keys.has('codec'), false);
  assert.equal(text.includes('dictionaries.'), false);
  for (const table of ['additional_collection_refs', 'additional_schema_refs', 'taxonomy_ranks', 'reference_id']) {
    assert.equal(text.includes(table), false, table);
  }
});

test('links are named components; a dictionary field is named, not enumerated', () => {
  const { schemas } = doc.components;
  const { primaryReference, additionalReferences } = schemas.Collection.properties;
  assert.deepEqual(primaryReference.anyOf, [{ $ref: '#/components/schemas/ReferenceLink' }, { type: 'null' }]);
  assert.deepEqual(additionalReferences.items, { $ref: '#/components/schemas/ReferenceLink' });
  assert.match(schemas.ReferenceLink.description, /\/api\/v1\/references\/\{permid\}/);

  const { lithology } = schemas.Collection.properties.lithofacies.items.properties;
  assert.equal(lithology.type, 'string');
  assert.equal('enum' in lithology, false);
  assert.match(lithology.description, /lithologies vocabulary; curators may add terms/);
});

test('two labels for one link target fail the build of the components', async () => {
  const { authoritySource } = await import('../../payloadSchemas/authority.schema.js');
  const original = authoritySource.properties.reference['x-link'].label;
  authoritySource.properties.reference['x-link'].label = 'doi';
  try {
    assert.throws(() => publishedComponents(), /Links to 'references' are declared with two labels/);
  } finally {
    authoritySource.properties.reference['x-link'].label = original;
  }
});

test('the published schema tree is recursive and closed at every depth', () => {
  const schema = {
    permid: 's', title: 't', year: '2023', primaryReference: null, additionalReferences: [],
    characters: [{ permid: 'c', name: 'n', characters: [], states: [{ permid: 'st', name: 'm', quantitative: false, states: [] }] }],
  };
  assertPublished('Schema', schema);
  schema.characters[0].states[0].states.push({ permid: 'st2', name: 'x', quantitative: false, states: [], stray: 1 });
  assert.throws(() => assertPublished('Schema', schema), /stray/);
});

test('the viewer is HTML, and the description is linked by relation, not listed as a resource', async () => {
  const ui = await app.inject({ method: 'GET', url: '/api/v1/docs' });
  assert.equal(ui.statusCode, 200);
  assert.match(ui.headers['content-type'], /text\/html/);

  const { data, links } = (await app.inject({ method: 'GET', url: '/api/v1' })).json();
  assert.equal('openapi.json' in data.resources || 'docs' in data.resources, false);
  assert.ok(links['service-desc'].endsWith('/api/v1/openapi.json'));
  assert.ok(links['service-doc'].endsWith('/api/v1/docs'));
});

test('the viewer carries PBDB branding, not the framework\'s', async () => {
  const html = (await app.inject({ method: 'GET', url: '/api/v1/docs' })).body;
  assert.match(html, /<title>PBDB2 API<\/title>/);
  assert.doesNotMatch(html, /favicon-(16x16|32x32)\.png/);

  const icon = await app.inject({ method: 'GET', url: html.match(/<link rel="icon"[^>]*href="([^"]+)"/)[1] });
  assert.equal(icon.statusCode, 200);
  assert.equal(icon.headers['content-type'], 'image/x-icon');

  const init = (await app.inject({ method: 'GET', url: '/api/v1/docs/static/swagger-initializer.js' })).body;
  assert.match(init, /data:image\/png;base64,iVBOR/);
});

test('a hidden route still answers as before', async () => {
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/specimens' })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/references' })).statusCode, 201);
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/v1/taxa/x' })).statusCode, 405);
});

test('a field the response schema does not declare reaches the body unchanged', async (t) => {
  // Undeclared by the published Reference, and of the wrong type for a declared
  // one: a serializer built from the schema would drop the first and coerce the
  // second. The body must carry both as the handler built them.
  const payload = { publicationType: 'other', publicationYear: 1998, undeclared: { kept: [1, null, '2'] } };
  const pg = { query: async () => ({ rows: [{ permid: 'ref-1', payload }] }) };
  const withPg = build({ pg });
  t.after(() => withPg.close());

  const { data } = (await withPg.inject({ method: 'GET', url: '/api/v1/references/ref-1' })).json();
  assert.deepEqual(data, { permid: 'ref-1', ...payload });
});
