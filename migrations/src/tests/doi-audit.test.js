import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDoi, isWellFormedDoi, tokens, score, verdictFor, verdictRow, resolutionOf, authorsAgree,
  formatVerdictFile, parseVerdictFile, VERDICT_COLUMNS,
} from '../refs-migration/dois.js';
import { createResolver, selectForAudit, metadataFrom, USER_AGENT } from '../refs-migration/audit-dois.js';

// --- Normalization ---

test('normalizeDoi removes labels and resolver prefixes', () => {
  for (const s of [
    'doi: 10.1017/S0022336000020096',
    'DOI:10.1017/S0022336000020096',
    'https://doi.org/10.1017/S0022336000020096',
    'http://dx.doi.org/10.1017/S0022336000020096',
    'dx.doi.org/10.1017/S0022336000020096',
    'doi.org/10.1017/S0022336000020096',
    '^10.1017/S0022336000020096',
    '  10.1017/S0022336000020096 ',
  ]) assert.equal(normalizeDoi(s), '10.1017/S0022336000020096', s);
});

test('normalizeDoi keeps case, and a SICI DOI is well formed', () => {
  const doi = normalizeDoi('DOI:10.1666/0022-3360(2001)075<0001:ANSOTE>2.0.CO;2');
  assert.equal(doi, '10.1666/0022-3360(2001)075<0001:ANSOTE>2.0.CO;2');
  assert.ok(isWellFormedDoi(doi));
});

test('non-DOI strings are not well formed', () => {
  for (const s of [
    '10.666/12-075', '10.111/let.12205', '10.1016/ j.palaeo.2010.01.001',
    'http://hdl.handle.net/2246/1234', 'http://www.jstor.org/stable/1302950',
    '17 December 1871', '-', 'Smith, J., and Jones, K.',
  ]) assert.ok(!isWellFormedDoi(normalizeDoi(s)), s);
});

// --- Scoring ---

test('tokens ignore markup, accents, case and short words', () => {
  assert.deepEqual([...tokens('<i>Paléontologie</i> Française')], ['paleontologie', 'francaise']);
  assert.deepEqual([...tokens('On a new fish')], ['new', 'fish']);
});

test('score is token containment over the smaller set', () => {
  assert.equal(score('Paléontologie française', '<i>Paleontologie</i> Française'), 1);
  assert.equal(score('On a new fish', 'A new fish of Ohio'), 1);
  assert.equal(score('', 'A new fish'), 0);
  assert.equal(score('A b', 'A new fish'), 0);
  assert.equal(score('new fish ohio indiana', 'new fish in texas lakes'), 0.5);
});

test('small caps, sub/superscript and escaped tags do not split words', () => {
  assert.deepEqual([...tokens('A new ammonoid fauna from the <scp>C</scp>arnian')], ['new', 'ammonoid', 'fauna', 'carnian']);
  assert.deepEqual([...tokens('JURASSIC &lt;italic&gt;CAMPTONECTES&lt;/italic&gt; (BIVALVIA)')], ['jurassic', 'camptonectes', 'bivalvia']);
  assert.deepEqual([...tokens('artiodactyl<i>Anthracokeryx</i>and')], ['artiodactyl', 'anthracokeryx']);
});

test('function words do not count', () => {
  assert.deepEqual([...tokens('The Lancet')], ['lancet']);
  assert.equal(score('Descriptions of the Crinoidea', 'The Lancet'), 0);
  assert.deepEqual([...tokens('Revisión de las avispas del Mioceno')], ['revision', 'avispas', 'mioceno']);
});

test('authorsAgree ignores accents and case, and allows a typo or a compound name', () => {
  assert.ok(authorsAgree('Hubner', 'HÜBNER'));
  assert.ok(authorsAgree('Runnergar', 'Runnegar'));
  assert.ok(authorsAgree('Přikryl', 'Pikryl'));
  assert.ok(authorsAgree('Gutierrez-Marco', 'Gutiérrez-M.'));
  assert.ok(!authorsAgree('Szalay', 'Krishtalka'));
  assert.ok(!authorsAgree('Matsumoto', '松本'));
  assert.ok(!authorsAgree('Hibbard', ''));
});

// --- Verdicts ---

const ref = (over) => ({ reference_no: 1, doi: '10.1234/x', reftitle: null, pubtitle: null, pubyr: '1990', ...over });
const meta = (over) => ({ source: 'crossref', title: '', container: '', year: 1990, firstAuthor: '', ...over });

test('rule 1: malformed', () => {
  assert.deepEqual(verdictFor(ref({ doi: '-' }), null), { verdict: 'malformed', score: '' });
});

test('rule 2: unresolvable', () => {
  assert.equal(verdictFor(ref({ reftitle: 'A' }), meta({ source: 'none' })).verdict, 'unresolvable');
});

test('rule 3: uncertain without metadata or titles', () => {
  const r = ref({ reftitle: 'Crinoids of Iowa' });
  assert.deepEqual(verdictFor(r, meta({ source: 'handle' })), { verdict: 'uncertain', score: '' });
  assert.equal(verdictFor(ref({}), meta({ title: 'Crinoids' })).verdict, 'uncertain');
  assert.equal(verdictFor(r, meta({ title: '' })).verdict, 'uncertain');
});

test('rule 4: match, years within one', () => {
  const v = verdictFor(ref({ reftitle: 'Crinoids of Iowa', pubyr: '1866' }), meta({ title: 'Crinoids of Iowa', year: 1867 }));
  assert.deepEqual(v, { verdict: 'match', score: '1.00' });
  assert.equal(verdictFor(ref({ reftitle: 'Crinoids of Iowa', pubyr: '' }), meta({ title: 'Crinoids of Iowa' })).verdict, 'match');
});

test('rule 5: related-work when the years disagree', () => {
  const v = verdictFor(ref({ reftitle: 'New ceratopsian from Alberta', pubyr: '2005', author1last: 'Ryan' }),
    meta({ title: 'A new ceratopsian from Alberta', year: 2008, firstAuthor: 'Ryan' }));
  assert.equal(v.verdict, 'match', 'full title and author: the year is off');
  const partial = verdictFor(ref({ reftitle: 'New ceratopsian material from Alberta', pubyr: '2005', author1last: 'Ryan' }),
    meta({ title: 'New ceratopsian teeth from Alberta', year: 2008, firstAuthor: 'Ryan' }));
  assert.equal(partial.verdict, 'related-work', 'part of the title: another paper by the author');
});

test('a review of the book stays related-work', () => {
  const v = verdictFor(ref({ reftitle: 'Systematics of the Omomyidae', pubyr: '1976', author1last: 'Szalay' }),
    meta({ title: 'Szalay. Systematics of the Omomyidae', year: 1978, firstAuthor: 'Krishtalka' }));
  assert.equal(v.verdict, 'related-work');
});

test('an online-first date with the full title and author is a match', () => {
  const v = verdictFor(ref({ reftitle: 'Earliest Cretaceous mammals from the western United States', pubyr: '2014', author1last: 'Cifelli' }),
    meta({ title: 'Earliest Cretaceous mammals from the western United States', year: 2012, firstAuthor: 'Cifelli' }));
  assert.equal(v.verdict, 'match');
});

test('rule 6: part-or-container — the DOI is the chapter\'s book', () => {
  const v = verdictFor(ref({ reftitle: 'Late Cretaceous turtles', pubtitle: 'The Dinosaur Park Formation' }),
    meta({ title: 'Dinosaur Park Formation' }));
  assert.equal(v.verdict, 'part-or-container');
});

test('rule 6: part-or-container — the DOI is a part of the ref', () => {
  const v = verdictFor(ref({ reftitle: 'Vertebrate Paleontology in Utah' }),
    meta({ title: 'Chapter 4: Mammals', container: 'Vertebrate Paleontology in Utah' }));
  assert.equal(v.verdict, 'part-or-container');
});

test('another article in the same journal is wrong, not part-or-container', () => {
  const v = verdictFor(ref({ reftitle: 'Pleistocene horses of Nebraska', pubtitle: 'Journal of Paleontology', author1last: 'Ray' }),
    meta({ title: 'Ordovician brachiopods', container: 'Journal of Paleontology', firstAuthor: 'Cooper' }));
  assert.equal(v.verdict, 'wrong');
});

test('same journal, author and year rescues a translated title as uncertain', () => {
  const r = ref({ reftitle: 'New elasmosaurids from the Upper Cretaceous of Chile', pubtitle: 'Andean Geology', pubyr: '2015', author1last: 'Otero' });
  const m = meta({ title: 'Nuevos elasmosáuridos del Cretácico Superior de Chile', container: 'Andean Geology', year: 2015, firstAuthor: 'Otero' });
  assert.equal(verdictFor(r, m).verdict, 'uncertain');
  assert.equal(verdictFor({ ...r, pubyr: '2010' }, m).verdict, 'wrong', 'the year must agree too');
  assert.equal(verdictFor({ ...r, author1last: 'Smith' }, m).verdict, 'wrong', 'the author must agree too');
});

test('rule 7: a partial agreement is uncertain', () => {
  const v = verdictFor(ref({ reftitle: 'fossil turtles oklahoma county kansas' }),
    meta({ title: 'fossil lizards region today texas oklahoma' }));
  assert.equal(v.verdict, 'uncertain');
  assert.equal(v.score, '0.40');
});

test('the Hall 1866 case is wrong although author and year agree', () => {
  const v = verdictFor(
    ref({ reftitle: 'Descriptions of new species of Crinoidea from the Carboniferous rocks of the Mississippi Valley', pubyr: '1866' }),
    meta({ title: 'Clinical lecture on diseases of the heart', year: 1866, firstAuthor: 'Hall' }),
  );
  assert.equal(v.verdict, 'wrong');
});

// --- Verdict file ---

test('verdict file rows round-trip', () => {
  const rows = [
    verdictRow(ref({ reference_no: 12, reftitle: 'Paléontologie française: Terrains crétacés, 1' }),
      meta({ title: 'Paléontologie "française", 1', container: 'Bull, Soc.', year: 1850, firstAuthor: 'd’Orbigny' })),
    verdictRow(ref({ reference_no: 3, doi: 'Smith, J., and Jones, K.' }), null),
  ];
  const text = formatVerdictFile(rows);
  assert.ok(text.startsWith(`${VERDICT_COLUMNS.join(',')}\n3,"Smith, J., and Jones, K.",,malformed,,,,,,\n`));
  const back = parseVerdictFile(text);
  assert.deepEqual([...back.keys()], [3, 12]);
  assert.equal(back.get(12).registered_title, 'Paléontologie "française", 1');
  assert.equal(back.get(12).registered_container, 'Bull, Soc.');
  assert.equal(back.get(12).registered_year, '1850');
  assert.equal(back.get(3).source_doi, 'Smith, J., and Jones, K.');
  assert.equal(formatVerdictFile(back.values()), text);
});

test('a field with a newline round-trips', () => {
  const row = { ...verdictRow(ref({ reference_no: 5, doi: '-' }), null), source_doi: 'a\nb' };
  assert.equal(parseVerdictFile(formatVerdictFile([row])).get(5).source_doi, 'a\nb');
});

test('a wrong header throws', () => {
  assert.throws(() => parseVerdictFile('reference_no,doi\n1,10.1/x\n'), /header/);
});

test('rescoring from a stored row reproduces the verdict', () => {
  const r = ref({ reference_no: 7, reftitle: 'Crinoids of Iowa' });
  const row = parseVerdictFile(formatVerdictFile([verdictRow(r, meta({ title: 'Crinoids of Iowa' }))])).get(7);
  assert.deepEqual(verdictRow(r, resolutionOf(row)), { ...row, reference_no: 7 });
});

// --- Selection ---

test('incremental selection: missing and stale rows only', () => {
  const rows = new Map([[1, { source_doi: '10.1/a' }], [2, { source_doi: '10.1/old' }]]);
  const refs = [{ reference_no: 1, doi: ' 10.1/a' }, { reference_no: 2, doi: '10.1/new' }, { reference_no: 3, doi: '10.1/c' }];
  assert.deepEqual(selectForAudit(refs, rows, false).map((r) => r.reference_no), [2, 3]);
  assert.equal(selectForAudit(refs, rows, true).length, 3);
});

// --- Resolver ---

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init) => { calls.push({ url, init }); return handler(url, calls.length); };
  return { fn, calls };
}

const noSleep = { sleep: async () => {} };

test('a Crossref DOI needs one request', async () => {
  const f = fakeFetch(() => json(200, { message: {
    title: ['Crinoids'], subtitle: ['of Iowa'], 'container-title': ['J. Paleo.'],
    issued: { 'date-parts': [[1866, 3]] }, author: [{ family: 'Hall' }],
  } }));
  const r = createResolver({ fetchFn: f.fn, ...noSleep });
  assert.deepEqual(await r.resolve('10.1/a<b>;c'), {
    source: 'crossref', title: 'Crinoids: of Iowa', container: 'J. Paleo.', year: 1866, firstAuthor: 'Hall',
  });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, 'https://api.crossref.org/works/10.1%2Fa%3Cb%3E%3Bc');
});

test('a DataCite DOI comes from doi.org content negotiation', async () => {
  const f = fakeFetch((url) => {
    if (url.startsWith('https://api.crossref.org')) return json(404, {});
    if (url.includes('/api/handles/')) return json(200, { responseCode: 1 });
    return new Response(JSON.stringify({ title: 'Dataset', issued: { 'date-parts': [[2020]] }, author: [{ literal: 'IODP' }] }),
      { status: 200, headers: { 'content-type': 'application/vnd.citationstyles.csl+json; charset=utf-8' } });
  });
  const res = await createResolver({ fetchFn: f.fn, ...noSleep }).resolve('10.5061/x');
  assert.deepEqual(res, { source: 'doi.org', title: 'Dataset', container: '', year: 2020, firstAuthor: 'IODP' });
  assert.equal(f.calls[2].init.headers.Accept, 'application/vnd.citationstyles.csl+json');
});

test('an unregistered DOI has source none', async () => {
  const f = fakeFetch((url) => (url.includes('/api/handles/') ? json(404, { responseCode: 100 }) : json(404, {})));
  assert.equal((await createResolver({ fetchFn: f.fn, ...noSleep }).resolve('10.1/none')).source, 'none');
});

test('a registered DOI without CSL has source handle', async () => {
  const f = fakeFetch((url) => {
    if (url.includes('/api/handles/')) return json(200, { responseCode: 1 });
    if (url.startsWith('https://doi.org/10')) return new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } });
    return json(404, {});
  });
  assert.equal((await createResolver({ fetchFn: f.fn, ...noSleep }).resolve('10.1/h')).source, 'handle');
});

test('429 waits for Retry-After, then repeats the request', async () => {
  const waits = [];
  const f = fakeFetch((url, n) => (n === 1 ? json(429, {}, { 'retry-after': '10' }) : json(200, { message: { title: ['X'] } })));
  const r = createResolver({ fetchFn: f.fn, sleep: async (ms) => { waits.push(ms); } });
  assert.equal((await r.resolve('10.1/x')).title, 'X');
  assert.ok(waits.includes(10000));
  assert.equal(r.requestCount(), 2);
});

test('network errors through every retry exhaust, not a verdict', async () => {
  const f = fakeFetch(() => { throw new TypeError('fetch failed'); });
  await assert.rejects(createResolver({ fetchFn: f.fn, ...noSleep }).resolve('10.1/x'), { name: 'Error', message: /network errors/ });
  assert.equal(f.calls.length, 6);
});

test('requests send the generic User-Agent and no email address', async () => {
  const f = fakeFetch((url) => (url.includes('/api/handles/') ? json(404, { responseCode: 100 }) : json(404, {})));
  await createResolver({ fetchFn: f.fn, ...noSleep }).resolve('10.1/x');
  for (const { url, init } of f.calls) {
    assert.equal(init.headers['User-Agent'], USER_AGENT);
    assert.ok(!/@|mailto/.test(url + JSON.stringify(init)));
  }
});

test('metadataFrom falls back to published year and author name', () => {
  const m = metadataFrom({ title: 'T', published: { 'date-parts': [[1999]] }, author: [{ name: 'Expedition 342 Scientists' }] }, 'crossref');
  assert.equal(m.year, 1999);
  assert.equal(m.firstAuthor, 'Expedition 342 Scientists');
});
