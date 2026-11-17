// Shared by audit-dois.js and migrate-refs.js: DOI normalization, title scoring, the
// verdict rules, and the verdict file. Pure apart from the file read and write.
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { csvField } from '../lib/anomaly-log.js';

// --- Normalization ---

const DOI_PREFIX = /^(?:doi:\s*|https?:\/\/|dx\.doi\.org\/|doi\.org\/|\^)/i;

// Trimmed, with any leading run of DOI labels and resolver prefixes removed.
export function normalizeDoi(value) {
  let s = (value ?? '').trim();
  for (let prev = null; prev !== s;) {
    prev = s;
    s = s.replace(DOI_PREFIX, '');
  }
  return s;
}

export const isWellFormedDoi = (doi) => /^10\.\d{4,9}\/\S+$/.test(doi);

// --- Scoring ---

export const AGREE = 0.6;
export const UNCERTAIN_FLOOR = 0.3;
export const YEAR_TOLERANCE = 1;

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

// Function words that would let two unrelated titles agree ("The Lancet").
const STOPWORDS = new Set([
  'the', 'and', 'for', 'from', 'with', 'into', 'its', 'are', 'was', 'were', 'this', 'that',
  'des', 'les', 'une', 'sur', 'dans', 'par', 'avec', 'der', 'die', 'das', 'und', 'von', 'den', 'dem', 'ein', 'eine',
  'del', 'los', 'las', 'por', 'para', 'con', 'una', 'della', 'dei', 'delle', 'dos', 'das', 'uma', 'com',
]);

// The distinct words of 3+ letters, other than stopwords, ignoring markup, accents and case. Small caps,
// sub- and superscript tags sit inside words (`<scp>C</scp>arnian`), so they are
// removed without a break; any other tag separates words.
export function tokens(s) {
  const words = (s ?? '')
    .replace(/&(lt|gt|amp|quot|apos);/g, (_, e) => ENTITIES[e])
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/<\/?(?:scp|sub|sup)>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/\P{L}+/u)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  return new Set(words);
}

// Token containment: shared words over the smaller set; 0 when either is empty.
export function score(a, b) {
  const A = tokens(a);
  const B = tokens(b);
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / Math.min(A.size, B.size);
}

const yearOf = (value) => {
  const m = String(value ?? '').match(/\d{4}/);
  return m ? Number(m[0]) : null;
};

const yearsAgree = (a, b) => a === null || b === null || Math.abs(a - b) <= YEAR_TOLERANCE;

const blank = (s) => !(s ?? '').trim();

const surname = (s) => (s ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\P{L}/gu, '');

function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

// First-author surnames agree, ignoring accents, case and punctuation: equal, one a
// prefix of the other (4+ letters, for compound names), or one edit apart (typos).
export function authorsAgree(a, b) {
  const x = surname(a);
  const y = surname(b);
  if (x.length < 2 || y.length < 2) return false;
  if (x === y || editDistance(x, y) <= 1) return true;
  return Math.min(x.length, y.length) >= 4 && (x.startsWith(y) || y.startsWith(x));
}

// --- Verdicts ---

export const KEPT_VERDICTS = new Set(['match', 'part-or-container', 'uncertain']);
export const DROPPED_VERDICTS = new Set(['wrong', 'related-work', 'unresolvable', 'malformed']);

// Authors never condemn a DOI (a surname-and-year match is how the wrong ones were
// attached); they only rescue one the titles alone would drop.
// ref: { doi, reftitle, pubtitle, pubyr, author1last }. resolution: { source, title, container, year, firstAuthor }
// with source 'crossref' | 'doi.org' (metadata), 'handle' (registered, no metadata) or
// 'none' (not registered); null when the DOI is malformed and was never resolved.
// Returns { verdict, score } with score as T to two decimals, or '' when rules 1–3 decide.
export function verdictFor(ref, resolution) {
  if (!isWellFormedDoi(normalizeDoi(ref.doi))) return { verdict: 'malformed', score: '' };
  if (resolution.source === 'none') return { verdict: 'unresolvable', score: '' };
  const reftitle = (ref.reftitle ?? '').trim();
  const pubtitle = (ref.pubtitle ?? '').trim();
  const refTitle = reftitle || pubtitle;
  if (resolution.source === 'handle' || !refTitle || blank(resolution.title)) {
    return { verdict: 'uncertain', score: '' };
  }
  const T = score(refTitle, resolution.title);
  const fixed = T.toFixed(2);
  const authors = authorsAgree(ref.author1last, resolution.firstAuthor);
  const years = yearsAgree(yearOf(ref.pubyr), yearOf(resolution.year));
  if (T >= AGREE) {
    // The full title and the author with the year off: a typo, or an online-first date.
    if (years || (fixed === '1.00' && authors)) return { verdict: 'match', score: fixed };
    return { verdict: 'related-work', score: fixed };
  }
  // The ref's pubtitle is never compared with the registered container: another
  // article in the right journal shares it.
  const C = reftitle
    ? Math.max(pubtitle ? score(pubtitle, resolution.title) : 0, score(reftitle, resolution.container))
    : 0;
  if (C >= AGREE) return { verdict: 'part-or-container', score: fixed };
  if (Math.max(T, C) >= UNCERTAIN_FLOOR) return { verdict: 'uncertain', score: fixed };
  // Same journal, author and year, with the title in another language or missing.
  if (pubtitle && score(pubtitle, resolution.container) >= AGREE && authors && years) {
    return { verdict: 'uncertain', score: fixed };
  }
  return { verdict: 'wrong', score: fixed };
}

// --- Verdict file ---

export const VERDICT_COLUMNS = [
  'reference_no', 'source_doi', 'doi', 'verdict', 'score', 'source',
  'registered_title', 'registered_container', 'registered_year', 'registered_first_author',
];
const HEADER = VERDICT_COLUMNS.join(',');

// One row object for a ref, from its verdict and (when resolved) its resolution.
export function verdictRow(ref, resolution) {
  const { verdict, score: s } = verdictFor(ref, resolution);
  const malformed = verdict === 'malformed';
  return {
    reference_no: ref.reference_no,
    source_doi: (ref.doi ?? '').trim(),
    doi: malformed ? '' : normalizeDoi(ref.doi),
    verdict,
    score: s,
    source: malformed ? '' : resolution.source,
    registered_title: resolution?.title ?? '',
    registered_container: resolution?.container ?? '',
    registered_year: resolution?.year ?? '',
    registered_first_author: resolution?.firstAuthor ?? '',
  };
}

// The resolution a row records, for rescoring without the network.
export const resolutionOf = (row) => ({
  source: row.source,
  title: row.registered_title,
  container: row.registered_container,
  year: row.registered_year,
  firstAuthor: row.registered_first_author,
});

export function formatVerdictFile(rows) {
  const sorted = [...rows].sort((a, b) => Number(a.reference_no) - Number(b.reference_no));
  const lines = sorted.map((row) => VERDICT_COLUMNS.map((c) => csvField(row[c] ?? '')).join(','));
  return [HEADER, ...lines].join('\n') + '\n';
}

// Written to a temporary file and renamed, so an interrupted write leaves the old file.
export function writeVerdictFile(path, rows) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, formatVerdictFile(rows));
  renameSync(tmp, path);
}

// RFC 4180: quoted fields may hold commas, newlines and doubled quotes.
export function parseCsv(text) {
  const records = [];
  let record = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { record.push(field); field = ''; }
    else if (ch === '\n') { record.push(field); records.push(record); record = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (quoted) throw new Error('unterminated quoted field');
  if (field !== '' || record.length > 0) { record.push(field); records.push(record); }
  return records;
}

// The verdict rows by reference_no. Throws on a wrong header or a malformed row.
export function parseVerdictFile(text) {
  const [header, ...records] = parseCsv(text);
  if (header?.join(',') !== HEADER) throw new Error(`verdict file header is not "${HEADER}"`);
  const rows = new Map();
  for (const record of records) {
    if (record.length !== VERDICT_COLUMNS.length) {
      throw new Error(`verdict file row has ${record.length} fields, expected ${VERDICT_COLUMNS.length}: ${record.join(',')}`);
    }
    const row = Object.fromEntries(VERDICT_COLUMNS.map((c, i) => [c, record[i]]));
    row.reference_no = Number(row.reference_no);
    rows.set(row.reference_no, row);
  }
  return rows;
}

export const readVerdictFile = (path) => parseVerdictFile(readFileSync(path, 'utf8'));
