import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeReadRepository, linkProjections } from '../src/lib/repository.js';
import { descriptorFor, targetFor } from '../src/lib/resource-tables.js';
import { groupBase, hydrateLinkHrefs } from '../src/lib/link-hydration.js';

/**
 * Link enrichment generalized beyond references: the target route group is a
 * declaration, not a hardcoded table. These cover the capability the existing
 * reference suites cannot — a non-`references` target, a permid-keyed join, and
 * one record linking into two different groups — plus the regression pin that
 * the four pre-existing reference declarations emit the very same SQL they did
 * before the target became a parameter.
 */
function fakePg(handler) {
  const calls = [];
  return {
    calls,
    query: async (text, values) => {
      calls.push({ text, values });
      return handler(text, values);
    },
  };
}

// The exact expressions emitted before link targets were parameterized. Any
// diff here is a behavior change, not a stale expectation.
const PRE_REFACTOR_SQL = {
  authorities: [
    `(SELECT json_build_object('title', r.reference->>'title', 'permid', r.permid) FROM refs r WHERE r.id = "authorities"."reference_id" AND NOT COALESCE(r.removed, false)) AS "reference"`,
  ],
  collections: [
    `(SELECT json_build_object('title', r.reference->>'title', 'permid', r.permid) FROM refs r WHERE r.id = "collections"."reference_id" AND NOT COALESCE(r.removed, false)) AS "primaryReference"`,
    `(SELECT COALESCE(json_agg(json_build_object('title', r.reference->>'title', 'permid', r.permid)), '[]'::json) FROM "additional_collection_refs" j JOIN refs r ON r.id = j.reference_id WHERE j."collection_id" = "collections".id AND NOT COALESCE(r.removed, false)) AS "additionalReferences"`,
  ],
  schemas: [
    `(SELECT json_build_object('title', r.reference->>'title', 'permid', r.permid) FROM refs r WHERE r.id = "schemas"."reference_id" AND NOT COALESCE(r.removed, false)) AS "primaryReference"`,
    `(SELECT COALESCE(json_agg(json_build_object('title', r.reference->>'title', 'permid', r.permid)), '[]'::json) FROM "additional_schema_refs" j JOIN refs r ON r.id = j.reference_id WHERE j."schema_id" = "schemas".id AND NOT COALESCE(r.removed, false)) AS "additionalReferences"`,
  ],
};

// The schema tree correlates the same declarations to its head CTE instead.
const PRE_REFACTOR_SQL_TS = [
  `(SELECT json_build_object('title', r.reference->>'title', 'permid', r.permid) FROM refs r WHERE r.id = ts."reference_id" AND NOT COALESCE(r.removed, false)) AS "primaryReference"`,
  `(SELECT COALESCE(json_agg(json_build_object('title', r.reference->>'title', 'permid', r.permid)), '[]'::json) FROM "additional_schema_refs" j JOIN refs r ON r.id = j.reference_id WHERE j."schema_id" = ts.id AND NOT COALESCE(r.removed, false)) AS "additionalReferences"`,
];

test('existing reference declarations emit byte-identical SQL after generalization', () => {
  for (const [resource, expected] of Object.entries(PRE_REFACTOR_SQL)) {
    const descriptor = descriptorFor(resource);
    assert.deepEqual(linkProjections(descriptor.links, `"${descriptor.table}"`), expected, resource);
  }
  assert.deepEqual(linkProjections(descriptorFor('schemas').links, 'ts'), PRE_REFACTOR_SQL_TS);
});

// A synthetic citing resource; nothing in the served API declares these yet.
const authorityLink = { target: 'authorities', on: 'id', via: 'authority_id' };
const conceptLink = { target: 'taxa', on: 'permid', via: 'concept_permid' };

test('a link to a non-references target resolves via that target and hydrates its own href', async () => {
  const pg = fakePg(() => ({
    rows: [
      {
        permid: 'txn-1',
        payload: { name: 'Calymene' },
        authority: { citation: 'Green 1974', permid: 'aut-7' },
      },
    ],
  }));
  const repo = makeReadRepository({
    pg,
    table: 'taxa',
    jsonbColumn: 'taxon',
    links: { authority: authorityLink },
  });

  const record = await repo.readHead('txn-1');
  // The target registry supplies the table, payload column and label key.
  assert.match(
    pg.calls[0].text,
    /json_build_object\('citation', r\.authority->>'citation', 'permid', r\.permid\) FROM authorities r/,
  );
  assert.match(pg.calls[0].text, /WHERE r\.id = "taxa"\."authority_id"/);

  hydrateLinkHrefs(record, { authority: authorityLink }, '/api/v1/taxa');
  assert.deepEqual(record.authority, {
    citation: 'Green 1974',
    permid: 'aut-7',
    href: '/api/v1/authorities/aut-7',
  });
});

test('a permid-keyed link matches on permid and yields the same object shape', async (t) => {
  // A self-referential target has to be registered to be linkable; register it
  // for this test only rather than shipping a taxa entry ahead of the resource.
  const targets = (await import('../src/lib/resource-tables.js')).LINK_TARGETS;
  targets.taxa = { table: 'taxa', payloadColumn: 'taxon', label: 'name' };
  t.after(() => {
    delete targets.taxa;
  });

  const pg = fakePg(() => ({
    rows: [{ permid: 'txn-1', payload: {}, accepted: { name: 'Calymene', permid: 'txn-9' } }],
  }));
  const repo = makeReadRepository({
    pg,
    table: 'taxa',
    jsonbColumn: 'taxon',
    links: { accepted: conceptLink },
  });

  const record = await repo.readHead('txn-1');
  // Permid-keyed: matched against the target's permid, with no id translation.
  assert.match(pg.calls[0].text, /WHERE r\.permid = "taxa"\."concept_permid"/);
  assert.doesNotMatch(pg.calls[0].text, /WHERE r\.id = "taxa"\."concept_permid"/);

  hydrateLinkHrefs(record, { accepted: conceptLink }, '/api/v1/taxa');
  assert.deepEqual(record.accepted, {
    name: 'Calymene',
    permid: 'txn-9',
    href: '/api/v1/taxa/txn-9',
  });
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

test('soft-removal suppression holds for a non-references target', async () => {
  const joinLink = {
    target: 'authorities',
    on: 'id',
    via: 'authority_id',
    joinTable: 'taxon_authorities',
    joinKey: 'taxon_id',
  };
  const links = { authority: authorityLink, authorities: joinLink };
  const pg = fakePg(() => ({
    // A removed single-valued target resolves to null in SQL; a removed
    // join-table row drops out of the aggregate.
    rows: [{ permid: 'txn-1', payload: {}, authority: null, authorities: [] }],
  }));
  const repo = makeReadRepository({ pg, table: 'taxa', jsonbColumn: 'taxon', links });

  const record = await repo.readHead('txn-1');
  const suppression = pg.calls[0].text.match(/NOT COALESCE\(r\.removed, false\)/g);
  assert.equal(suppression.length, 2, 'both link forms suppress removed targets');

  hydrateLinkHrefs(record, links, '/api/v1/taxa');
  assert.equal(record.authority, null, 'a removed single-valued target stays null');
  assert.deepEqual(record.authorities, [], 'a removed join-table entry is omitted');
});

test('neither join form exposes an internal serial id', async () => {
  const links = {
    authority: authorityLink,
    authorities: {
      target: 'authorities',
      on: 'id',
      via: 'authority_id',
      joinTable: 'taxon_authorities',
      joinKey: 'taxon_id',
    },
  };
  const pg = fakePg(() => ({
    rows: [
      {
        permid: 'txn-1',
        payload: { name: 'Calymene' },
        authority: { citation: 'Green 1974', permid: 'aut-7' },
        authorities: [{ citation: 'Blue 1980', permid: 'aut-8' }],
      },
    ],
  }));
  const repo = makeReadRepository({ pg, table: 'taxa', jsonbColumn: 'taxon', links });
  const record = await repo.readHead('txn-1');

  // Serial ids appear only in join predicates, never in a projected object.
  for (const expr of linkProjections(links, '"taxa"')) {
    const projected = expr.slice(expr.indexOf('json_build_object'), expr.indexOf('FROM'));
    assert.doesNotMatch(projected, /r\.id/);
  }
  for (const value of [record.authority, ...record.authorities]) {
    assert.deepEqual(Object.keys(value).sort(), ['citation', 'permid']);
  }
});

test('the link-target registry keys are route group names', () => {
  assert.deepEqual(targetFor('references'), {
    table: 'refs',
    payloadColumn: 'reference',
    label: 'title',
  });
  assert.equal(targetFor('nope'), undefined);
  assert.throws(
    () => linkProjections({ x: { target: 'nope', on: 'id', via: 'x_id' } }, '"taxa"'),
    /Unknown link target/,
  );
});
