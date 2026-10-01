import { test } from 'node:test';
import assert from 'node:assert/strict';

import { build } from '../src/app.js';
import { makeTaxaRepository } from '../src/lib/taxa-repository.js';

/**
 * The taxa resource: the API's first read-only, non-JSONB, non-version-chained
 * group. These cover what makes it different — the SQL it must NOT emit, the
 * 405 surface, the containing chain and its per-endpoint rules — driven through
 * `app.inject()` over a fake pg, so no database is required.
 */

// One depth-3 taxon with a real-shaped ltree path. The last element is its own
// concept, which must never appear in its own chain.
const OWN_CONCEPT = '01a08827-5ef9-71e5-a761-ba1298b75732';
const PARENT = '01a08827-5db4-7561-ba19-a10fe5dbdcc1';
const GRANDPARENT = '01a08827-6c18-70bb-a61b-537882be2fd1';
const PATH = [GRANDPARENT, PARENT, OWN_CONCEPT].map((p) => p.replaceAll('-', '_')).join('.');

const TAXON = {
  permid: OWN_CONCEPT,
  name: 'Calymene blumenbachii',
  rank: 'species',
  nomenclaturalStatus: null,
  classification_path: PATH,
  authority: { citation: 'Brongniart 1822', permid: 'aut-1' },
  accepted: { name: 'Calymene blumenbachii', permid: OWN_CONCEPT },
};

const ANCESTORS = [
  { concept_permid: GRANDPARENT, permid: GRANDPARENT, name: 'Trilobita', rank: 'class' },
  { concept_permid: PARENT, permid: PARENT, name: 'Calymene', rank: 'genus' },
];

/**
 * A fake pg that answers the two query shapes the taxa repository issues: the
 * breadcrumb fetch (matched by its `= ANY` predicate) and everything else.
 *
 * Rows are cloned per call. Hydration mutates the records it is handed, and a
 * real driver hands back fresh objects each query — a fake that shared
 * references would leak one test's hrefs into the next.
 */
function fakeTaxaPg({ taxa = [TAXON], ancestors = ANCESTORS } = {}) {
  const calls = [];
  const clone = (rows) => rows.map((row) => structuredClone(row));
  return {
    calls,
    query: async (text, values) => {
      calls.push({ text, values });
      if (/concept_permid = ANY/.test(text)) return { rows: clone(ancestors) };
      return { rows: clone(taxa) };
    },
  };
}

test('taxa single read returns the representation with a nested chain', async (t) => {
  const app = build({ pg: fakeTaxaPg() });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: `/api/v1/taxa/${OWN_CONCEPT}` });
  assert.equal(res.statusCode, 200);

  const { data, meta } = res.json();
  assert.equal(meta.type, 'taxon');
  assert.equal(data.permid, OWN_CONCEPT);
  assert.equal(data.name, 'Calymene blumenbachii');
  assert.equal(data.rank, 'species');
  assert.equal(data.nomenclaturalStatus, null);

  // Links carry their own group's href; the chain points back into taxa.
  assert.equal(data.authority.href, '/api/v1/authorities/aut-1');
  assert.equal(data.accepted.href, `/api/v1/taxa/${OWN_CONCEPT}`);

  // Outermost chain entry is the IMMEDIATE container, nesting root-ward.
  assert.equal(data.containingTaxa.name, 'Calymene');
  assert.equal(data.containingTaxa.rank, 'genus');
  assert.equal(data.containingTaxa.href, `/api/v1/taxa/${PARENT}`);
  assert.equal(data.containingTaxa.containingTaxa.name, 'Trilobita');
  assert.equal(data.containingTaxa.containingTaxa.containingTaxa, null, 'root ends the chain');
});

test('a taxon never appears in its own containing chain', async (t) => {
  const app = build({ pg: fakeTaxaPg() });
  t.after(() => app.close());

  const { data } = (
    await app.inject({ method: 'GET', url: `/api/v1/taxa/${OWN_CONCEPT}` })
  ).json();

  const chain = [];
  for (let n = data.containingTaxa; n; n = n.containingTaxa) chain.push(n.permid);
  assert.ok(!chain.includes(OWN_CONCEPT), 'the path ends at its own concept, never an ancestor');
});

test('the classification path is machinery, never part of the representation', async (t) => {
  const app = build({ pg: fakeTaxaPg() });
  t.after(() => app.close());

  const { data } = (
    await app.inject({ method: 'GET', url: `/api/v1/taxa/${OWN_CONCEPT}` })
  ).json();
  assert.ok(!('classification_path' in data));
  assert.ok(!('classificationPath' in data));
});

test('a missing taxon is a structured 404', async (t) => {
  const app = build({ pg: fakeTaxaPg({ taxa: [] }) });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/api/v1/taxa/nope' });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error.statusCode, 404);
});

test('taxa reads emit no version-chain and no soft-removal predicate', async (t) => {
  const pg = fakeTaxaPg();
  const app = build({ pg });
  t.after(() => app.close());

  await app.inject({ method: 'GET', url: `/api/v1/taxa/${OWN_CONCEPT}` });
  const [{ text }] = pg.calls;

  // `succeeded_by_id` does not exist on taxa — emitting it is a 42703, not a
  // degradation. `removed` exists but is never written by rebuild_taxa().
  assert.doesNotMatch(text, /succeeded_by_id/);
  assert.doesNotMatch(text, /t\.removed/);
  assert.doesNotMatch(text, /preceded_by_id/);
});

test('taxa reads select no internal ids and no opinion provenance', async (t) => {
  const pg = fakeTaxaPg();
  const app = build({ pg });
  t.after(() => app.close());

  await app.inject({ method: 'GET', url: `/api/v1/taxa/${OWN_CONCEPT}` });
  const select = pg.calls[0].text.slice(0, pg.calls[0].text.indexOf('FROM taxa'));

  assert.doesNotMatch(select, /winning_/, 'opinion provenance is never projected');
  assert.doesNotMatch(select, /original_permid/);
  assert.doesNotMatch(select, /accepted_spelling_permid/);
  assert.doesNotMatch(select, /\bt\.id\b/, 'the serial id is never projected');
});

test('the ancestor fetch pins permid = concept_permid', async (t) => {
  const pg = fakeTaxaPg();
  const app = build({ pg });
  t.after(() => app.close());

  await app.inject({ method: 'GET', url: `/api/v1/taxa/${OWN_CONCEPT}` });
  const breadcrumbs = pg.calls.find((c) => /concept_permid = ANY/.test(c.text));

  // Load-bearing: a concept is shared by up to 88 rows (synonyms and alternate
  // spellings), so matching on concept_permid alone fans one chain level out
  // into every synonym of it.
  assert.match(breadcrumbs.text, /t\.permid = t\.concept_permid/);
});

test('the chain costs one extra query regardless of depth', async (t) => {
  const pg = fakeTaxaPg();
  const app = build({ pg });
  t.after(() => app.close());

  await app.inject({ method: 'GET', url: `/api/v1/taxa/${OWN_CONCEPT}` });
  assert.equal(pg.calls.length, 2, 'one row read plus one pooled ancestor fetch — never per level');
});

test('the list omits the chain by default and includes it on request', async (t) => {
  const app = build({ pg: fakeTaxaPg() });
  t.after(() => app.close());

  const bare = (await app.inject({ method: 'GET', url: '/api/v1/taxa' })).json();
  assert.ok(!('containingTaxa' in bare.data[0]), 'omitted by default — ~457 kB per page');

  const expanded = (
    await app.inject({ method: 'GET', url: '/api/v1/taxa?includeContainingTaxa=true' })
  ).json();
  assert.equal(expanded.data[0].containingTaxa.name, 'Calymene');
  assert.equal(expanded.data[0].containingTaxa.href, `/api/v1/taxa/${PARENT}`);
});

test('includeContainingTaxa=false is accepted and omits the chain', async (t) => {
  const app = build({ pg: fakeTaxaPg() });
  t.after(() => app.close());

  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/taxa?includeContainingTaxa=false',
  });
  assert.equal(res.statusCode, 200);
  assert.ok(!('containingTaxa' in res.json().data[0]));
});

test('the chain opt-in is accepted alongside ids', async (t) => {
  const app = build({ pg: fakeTaxaPg() });
  t.after(() => app.close());

  // Unlike limit/cursor, which `ids` rejects: a multi-entity read is a list and
  // carries list semantics, so it opts into the same expansions.
  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/taxa?ids=${OWN_CONCEPT}&includeContainingTaxa=true`,
  });
  assert.equal(res.statusCode, 200);

  const body = res.json();
  assert.equal(body.meta.requested, 1);
  assert.deepEqual(body.meta.missing, []);
  assert.equal(body.data[0].containingTaxa.name, 'Calymene');
});

test('a non-boolean chain opt-in is rejected', async (t) => {
  const app = build({ pg: fakeTaxaPg() });
  t.after(() => app.close());

  for (const value of ['ture', '1', 'yes', 'TRUE', '']) {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/taxa?includeContainingTaxa=${value}`,
    });
    assert.equal(res.statusCode, 400, `\`${value}\` must be rejected`);
    assert.match(res.json().error.message, /true.*false/);
  }
});

test('the bare valueless chain opt-in is rejected', async (t) => {
  const app = build({ pg: fakeTaxaPg() });
  t.after(() => app.close());

  // Genuinely ambiguous — presence as truth, or an empty value? Stating it beats
  // resolving it in a direction the client did not choose.
  const res = await app.inject({ method: 'GET', url: '/api/v1/taxa?includeContainingTaxa' });
  assert.equal(res.statusCode, 400);
});

test('a root taxon has a null chain', async (t) => {
  const root = { ...TAXON, classification_path: OWN_CONCEPT.replaceAll('-', '_') };
  const app = build({ pg: fakeTaxaPg({ taxa: [root], ancestors: [] }) });
  t.after(() => app.close());

  const { data } = (
    await app.inject({ method: 'GET', url: `/api/v1/taxa/${OWN_CONCEPT}` })
  ).json();
  assert.equal(data.containingTaxa, null);
});

test('taxa lists are paginated on the same terms as every other group', async (t) => {
  const many = Array.from({ length: 3 }, (_, i) => ({
    ...TAXON,
    permid: `txn-${i}`,
    classification_path: PATH,
  }));
  const app = build({ pg: fakeTaxaPg({ taxa: many }) });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/api/v1/taxa?limit=2' });
  assert.equal(res.statusCode, 200);

  const body = res.json();
  assert.equal(body.data.length, 2, 'the extra row answers "is there more?", never data');
  assert.ok(body.links.next, 'a further page is linked');
  assert.equal(body.links.prev, null, 'the first page has no predecessor');
});

test('taxa declares no field filters, so a taxon attribute is an unknown param', async (t) => {
  const app = build({ pg: fakeTaxaPg() });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/api/v1/taxa?rank=genus' });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error.message, /rank/);
});

test('meta carries the standard envelope fields, trivially true for taxa', async (t) => {
  const app = build({ pg: fakeTaxaPg() });
  t.after(() => app.close());

  const { meta } = (
    await app.inject({ method: 'GET', url: `/api/v1/taxa/${OWN_CONCEPT}` })
  ).json();

  // Kept uniform deliberately: a taxon genuinely has no successor and is not
  // removed, so a generic client reading meta.version works here too. See the
  // change's design.md.
  assert.equal(meta.removed, false);
  assert.deepEqual(meta.version, { supersedes: null, supersededBy: null });
});

test('the repository is a plain module, usable without the route layer', async () => {
  const repo = makeTaxaRepository({ pg: fakeTaxaPg() });
  const taxon = await repo.readHead(OWN_CONCEPT);

  // No href anywhere: the persistence layer stays HTTP-agnostic, and hydration
  // happens at the route boundary.
  assert.equal(taxon.authority.href, undefined);
  assert.equal(taxon.containingTaxa.href, undefined);
  assert.equal(taxon.containingTaxa.name, 'Calymene');
});
