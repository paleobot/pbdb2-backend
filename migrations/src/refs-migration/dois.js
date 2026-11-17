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

// The distinct words of 3+ letters, ignoring markup, accents and case.
export function tokens(s) {
  const words = (s ?? '')
    .replace(/<[^>]+>/g, ' ')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/\P{L}+/u)
    .filter((w) => w.length >= 3);
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

// --- Verdicts ---

export const KEPT_VERDICTS = new Set(['match', 'part-or-container', 'uncertain']);
export const DROPPED_VERDICTS = new Set(['wrong', 'related-work', 'unresolvable', 'malformed']);

// ref: { doi, reftitle, pubtitle, pubyr }. resolution: { source, title, container, year }
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
  if (T >= AGREE) {
    const agree = yearsAgree(yearOf(ref.pubyr), yearOf(resolution.year));
    return { verdict: agree ? 'match' : 'related-work', score: fixed };
  }
  // The ref's pubtitle is never compared with the registered container: another
  // article in the right journal shares it.
  const C = reftitle
    ? Math.max(pubtitle ? score(pubtitle, resolution.title) : 0, score(reftitle, resolution.container))
    : 0;
  if (C >= AGREE) return { verdict: 'part-or-container', score: fixed };
  if (Math.max(T, C) >= UNCERTAIN_FLOOR) return { verdict: 'uncertain', score: fixed };
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
