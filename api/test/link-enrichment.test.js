import { test } from 'node:test';
import assert from 'node:assert/strict';

import { linkProjections } from '../src/lib/repository.js';
import { descriptorFor, targetFor, RESOURCE_DESCRIPTORS } from '../src/lib/resource-tables.js';
import { groupBase, hydrateLinkHrefs } from '../src/lib/link-hydration.js';

/**
 * Link enrichment generalized beyond references: the target route group is a
 * declaration, not a hardcoded table. Descriptor links are now declared only by
 * `taxa` (every other resource takes its links from its payload source), so
 * these drive `linkProjections` and `hydrateLinkHrefs` directly: a
 * non-`references` target, a permid-keyed match, and one record linking into
 * two different groups.
 */

test('no descriptor declares a join-table link, and only taxa declares links', () => {
  for (const [resource, descriptor] of Object.entries(RESOURCE_DESCRIPTORS)) {
    for (const [as, link] of Object.entries(descriptor.links ?? {})) {
      assert.equal('joinTable' in link, false, `${resource}.${as}`);
      assert.equal('joinKey' in link, false, `${resource}.${as}`);
    }
    assert.equal(Boolean(descriptor.links), resource === 'taxa', resource);
  }
});

test('authorities declares no descriptor links: its reference comes from the source', () => {
  assert.equal(descriptorFor('authorities').links, undefined);
  assert.ok(descriptorFor('authorities').source.properties.reference['x-link']);
});

test('collections declares no descriptor links: its references come from the source', () => {
  const { links, source, children } = descriptorFor('collections');
  assert.equal(links, undefined);
  assert.ok(source.properties.primaryReference['x-link']);
  assert.ok(source.properties.additionalReferences.items['x-link']);
  assert.deepEqual(children, [{ table: 'additional_collection_refs', fk: 'collection_id' }]);
});

test('schemas declares no descriptor links: its references come from the source', () => {
  const { links, source, children } = descriptorFor('schemas');
  assert.equal(links, undefined);
  assert.ok(source.properties.primaryReference['x-link']);
  assert.ok(source.properties.additionalReferences.items['x-link']);
  assert.deepEqual(children, [{ table: 'additional_schema_refs', fk: 'schema_id' }]);
});

// A synthetic citing resource; nothing in the served API declares these yet.
const authorityLink = { target: 'authorities', on: 'id', via: 'authority_id' };
const conceptLink = { target: 'taxa', on: 'permid', via: 'concept_permid' };

test('a link to a non-references target resolves via that target and hydrates its own href', () => {
  const [expr] = linkProjections({ authority: authorityLink }, '"taxa"');
  // The target registry supplies the table, payload column and label key.
  assert.match(
    expr,
    /json_build_object\('citation', r\.authority->>'citation', 'permid', r\.permid\) FROM authorities r/,
  );
  assert.match(expr, /WHERE r\.id = "taxa"\."authority_id"/);

  const record = { permid: 'txn-1', authority: { citation: 'Green 1974', permid: 'aut-7' } };
  hydrateLinkHrefs(record, { authority: authorityLink }, '/api/v1/taxa');
  assert.deepEqual(record.authority, {
    citation: 'Green 1974',
    permid: 'aut-7',
    href: '/api/v1/authorities/aut-7',
  });
});

test('a permid-keyed link matches on permid and yields the same object shape', () => {
  const [expr] = linkProjections({ accepted: conceptLink }, '"taxa"');
  // Permid-keyed: matched against the target's permid, with no id translation.
  assert.match(expr, /WHERE r\.permid = "taxa"\."concept_permid"/);
  assert.doesNotMatch(expr, /WHERE r\.id = "taxa"\."concept_permid"/);

  const record = { permid: 'txn-1', accepted: { name: 'Calymene', permid: 'txn-9' } };
  hydrateLinkHrefs(record, { accepted: conceptLink }, '/api/v1/taxa');
  assert.deepEqual(record.accepted, {
    name: 'Calymene',
    permid: 'txn-9',
    href: '/api/v1/taxa/txn-9',
  });
});

test('a plain-column target reads its label from the column, not a payload', () => {
  const [expr] = linkProjections({ accepted: conceptLink }, '"taxa"');

  // The label comes straight off the column; there is no `->>` dereference,
  // because `taxa` has no JSONB payload column to dereference.
  assert.match(expr, /json_build_object\('name', r\.name, 'permid', r\.permid\) FROM taxa r/);
  assert.doesNotMatch(expr, /->>/);
  assert.doesNotMatch(expr, /taxon/, 'no payload column is referenced');
});

test('a target declaring no label source throws rather than emitting bad SQL', async (t) => {
  const targets = (await import('../src/lib/resource-tables.js')).LINK_TARGETS;
  targets.broken = { table: 'broken' };
  t.after(() => {
    delete targets.broken;
  });

  assert.throws(
    () => linkProjections({ x: { target: 'broken', on: 'id', via: 'x_id' } }, '"taxa"'),
    /declares no label source/,
  );
});

test('links to two different groups each hydrate against their own group base', () => {
  const links = {
    reference: { target: 'references', on: 'id', via: 'reference_id' },
    authority: authorityLink,
  };
  const record = {
    permid: 'txn-1',
    reference: { title: 'On Trilobites', permid: 'ref-3' },
    authority: { citation: 'Green 1974', permid: 'aut-7' },
  };

  hydrateLinkHrefs(record, links, '/api/v1/taxa');
  assert.equal(record.reference.href, '/api/v1/references/ref-3');
  assert.equal(record.authority.href, '/api/v1/authorities/aut-7');
  // The base is derived from the mounted prefix, so a future version follows.
  assert.equal(groupBase('/api/v2/taxa', 'authorities'), '/api/v2/authorities');
});

test('soft-removal suppression holds for a non-references target', () => {
  const links = { authority: authorityLink, accepted: conceptLink };
  const exprs = linkProjections(links, '"taxa"');
  for (const expr of exprs) assert.match(expr, /NOT COALESCE\(r\.removed, false\)/);

  // A removed target resolves to null in SQL, and hydration leaves it null.
  const record = { permid: 'txn-1', authority: null, accepted: null };
  hydrateLinkHrefs(record, links, '/api/v1/taxa');
  assert.equal(record.authority, null);
  assert.equal(record.accepted, null);
});

test('a link projection exposes no internal serial id', () => {
  // Serial ids appear only in match predicates, never in a projected object.
  for (const expr of linkProjections({ authority: authorityLink, accepted: conceptLink }, '"taxa"')) {
    const projected = expr.slice(expr.indexOf('json_build_object'), expr.indexOf('FROM'));
    assert.doesNotMatch(projected, /r\.id/);
    assert.doesNotMatch(expr, /json_agg/, 'no join-table aggregate');
  }
});

test('the link-target registry keys are route group names', () => {
  assert.deepEqual(targetFor('references'), {
    table: 'refs',
    payloadColumn: 'reference',
    label: 'title',
  });
  // The plain-column form declares `labelColumn` and no payload column at all.
  assert.deepEqual(targetFor('taxa'), { table: 'taxa', labelColumn: 'name' });
  assert.equal(targetFor('nope'), undefined);
  assert.throws(
    () => linkProjections({ x: { target: 'nope', on: 'id', via: 'x_id' } }, '"taxa"'),
    /Unknown link target/,
  );
});
