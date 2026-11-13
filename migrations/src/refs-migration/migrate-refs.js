import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mariadb, pg, closeAll } from '../lib/db.js';
import { registerPermids } from '../lib/permids.js';
import { csvField } from '../lib/anomaly-log.js';
import { referenceSource } from '../../../payloadSchemas/reference.schema.js';
import { resolveEnums } from '../../../payloadSchemas/lib/enums.js';
import { deriveVariant } from '../../../payloadSchemas/lib/variants.js';
import { createAjv } from '../../../payloadSchemas/lib/ajv.js';

// --- Publication type mapping ---
// Legacy value → { referenceType (jsonb publicationType), bookType (jsonb field or null) }.
// The targets are values of referenceSource's inline publicationType enum; no table backs them.
const PUB_TYPE_MAP = {
  'journal article':   { referenceType: 'journal article', bookType: null },
  'serial monograph':  { referenceType: 'serial monograph', bookType: null },
  'unpublished':       { referenceType: 'unpublished', bookType: null },
  'book/book chapter': { referenceType: 'standalone book', bookType: 'monograph' },
  'book chapter':      { referenceType: 'article in edited collection', bookType: null },
  'book':              { referenceType: 'standalone book', bookType: 'monograph' },
  'compendium':        { referenceType: 'standalone book', bookType: 'compendium' },
  'Ph.D. thesis':      { referenceType: 'standalone book', bookType: 'Ph.D. thesis' },
  'M.S. thesis':       { referenceType: 'standalone book', bookType: 'M.S. thesis' },
  'guidebook':         { referenceType: 'standalone book', bookType: 'guidebook' },
  'news article':      { referenceType: 'other', bookType: null },
  'abstract':          { referenceType: 'other', bookType: null },
};

// Target language vocabulary: dictionaries.languages.name. The legacy enum spells
// Portuguese 'Portugese'; the dictionary corrects it.
const TARGET_LANGUAGES = new Set([
  'Chinese', 'English', 'French', 'German', 'Italian',
  'Japanese', 'Portuguese', 'Russian', 'Spanish', 'other', 'unknown',
]);
const LANGUAGE_CORRECTIONS = { Portugese: 'Portuguese' };

// The target types that are whole books, whose title legacy PBDB may keep in
// pubtitle alone, with reftitle empty. pubtitle has no other destination for
// these two. No Classic row maps to "edited collection", but it is a whole book,
// so a later rule that targets it keeps its titles.
const PUBTITLE_TITLE_TYPES = new Set(['standalone book', 'edited collection']);

// Two Classic types whose target depends on the titles. A ref has two titles when
// reftitle and pubtitle, trimmed, are both non-blank and differ ignoring case: a
// part and the book it appears in. Equal titles are one book entered twice.
export function hasTwoTitles(ref) {
  const reftitle = (ref.reftitle ?? '').trim();
  const pubtitle = (ref.pubtitle ?? '').trim();
  return !!reftitle && !!pubtitle && reftitle.toLowerCase() !== pubtitle.toLowerCase();
}

// A "book/book chapter" with two titles is a chapter; so is a "book" with two
// titles and editors. Returns null when the table applies, which makes every
// other "book/book chapter" a standalone book: one title is how Classic stored a
// whole book.
export function classifyByTitles(ref, editors) {
  if (!hasTwoTitles(ref)) return null;
  const type = ref.publication_type;
  if (type === 'book/book chapter' || (type === 'book' && editors)) {
    return { referenceTypeName: 'article in edited collection', bookType: null };
  }
  return null;
}

// --- Transform functions ---

export function mapPublicationType(ref, editors) {
  const byTitles = classifyByTitles(ref, editors);
  if (byTitles) return byTitles;

  const legacyType = ref.publication_type;
  if (!legacyType) {
    return { referenceTypeName: 'other', bookType: null };
  }
  const mapping = PUB_TYPE_MAP[legacyType];
  if (mapping) {
    return { referenceTypeName: mapping.referenceType, bookType: mapping.bookType };
  }
  console.warn(`  WARNING: unmapped publication_type '${legacyType}' → "other"`);
  return { referenceTypeName: 'other', bookType: null };
}

function buildAuthors(ref, refAuthorsMap) {
  const refNo = ref.reference_no;
  const normalizedAuthors = refAuthorsMap.get(refNo);

  if (normalizedAuthors && normalizedAuthors.length > 0) {
    return normalizedAuthors.map((a) => ({
      familyName: a.lastname || '',
      givenName: a.firstname || '',
    }));
  }

  // Fall back to flat fields
  const authors = [];
  if (ref.author1last) {
    authors.push({ familyName: ref.author1last.trim(), givenName: (ref.author1init || '').trim() });
  }
  if (ref.author2last) {
    authors.push({ familyName: ref.author2last.trim(), givenName: (ref.author2init || '').trim() });
  }

  // Parse otherauthors
  if (ref.otherauthors && ref.otherauthors.trim()) {
    const raw = ref.otherauthors.trim();
    // Split on ", and ", " and ", "; ", or ", " — common separators
    const parts = raw.split(/,\s*and\s+|\s+and\s+|;\s*|,\s+(?=[A-Z])/);
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      // Try "Last, Init" or "Init Last" patterns
      if (trimmed.includes(',')) {
        const [last, ...rest] = trimmed.split(',');
        authors.push({ familyName: last.trim(), givenName: rest.join(',').trim() });
      } else {
        const tokens = trimmed.split(/\s+/);
        if (tokens.length === 1) {
          authors.push({ familyName: tokens[0], givenName: '' });
        } else {
          // Assume last token is familyName
          authors.push({
            familyName: tokens[tokens.length - 1],
            givenName: tokens.slice(0, -1).join(' '),
          });
        }
      }
    }
  }

  if (authors.length === 0) {
    console.warn(`  WARNING: reference_no=${refNo} has no author data`);
  }

  return authors;
}

export function buildEditors(ref, refEditorsMap) {
  const refNo = ref.reference_no;
  const normalizedEditors = refEditorsMap.get(refNo);

  if (normalizedEditors && normalizedEditors.length > 0) {
    return normalizedEditors
      .map((e) => `${e.firstname ? e.firstname + ' ' : ''}${e.lastname}`.trim())
      .join(', ');
  }

  return ref.editors ? ref.editors.trim() || null : null;
}

export function mapPubtitle(ref, referenceTypeName) {
  const pubtitle = ref.pubtitle ? ref.pubtitle.trim() : null;
  if (!pubtitle) return {};

  switch (referenceTypeName) {
    case 'journal article':
      return { journalTitle: pubtitle };
    case 'serial monograph':
      return { seriesTitle: pubtitle };
    case 'article in edited collection':
      return { bookTitle: pubtitle };
    default:
      return {};
  }
}

function mapVolNo(ref, referenceTypeName) {
  const pubvol = ref.pubvol ? ref.pubvol.trim() : null;
  const pubno = ref.pubno ? ref.pubno.trim() : null;
  const result = {};

  if (referenceTypeName === 'journal article') {
    if (pubvol) result.journalVolume = pubvol;
    if (pubno) result.journalNumber = pubno;
  } else if (referenceTypeName === 'serial monograph') {
    if (pubvol) result.seriesVolume = pubvol;
  }

  return result;
}

function buildPages(firstpage, lastpage) {
  if (!firstpage || !firstpage.trim()) return null;

  let first = parseInt(firstpage.trim(), 10);
  if (isNaN(first)) {
    return null; // caller logs warning
  }
  // Pages are numbered from 1; a range starting at 0 means the first page. Caller logs.
  if (first === 0) first = 1;

  let last = first;
  if (lastpage && lastpage.trim()) {
    const parsed = parseInt(lastpage.trim(), 10);
    if (!isNaN(parsed)) {
      last = parsed;
    }
    // If lastpage is non-numeric, just use first=last
  }

  return { first, last };
}

function mapLanguage(legacyLang) {
  if (!legacyLang) return 'unknown';
  const trimmed = LANGUAGE_CORRECTIONS[legacyLang.trim()] ?? legacyLang.trim();
  if (TARGET_LANGUAGES.has(trimmed)) return trimmed;
  return 'other';
}

function mapPersonIds(ref) {
  let authorizerPersonId = ref.authorizer_no || 0;
  let entererPersonId = ref.enterer_no || 0;

  if (authorizerPersonId === 0 && entererPersonId !== 0) {
    console.warn(`  WARNING: reference_no=${ref.reference_no} authorizer_no=0, using enterer_no=${entererPersonId} as fallback`);
    authorizerPersonId = entererPersonId;
  } else if (entererPersonId === 0 && authorizerPersonId !== 0) {
    console.warn(`  WARNING: reference_no=${ref.reference_no} enterer_no=0, using authorizer_no=${authorizerPersonId} as fallback`);
    entererPersonId = authorizerPersonId;
  } else if (authorizerPersonId === 0 && entererPersonId === 0) {
    console.warn(`  WARNING: reference_no=${ref.reference_no} both authorizer_no and enterer_no are 0`);
    // Will need a fallback — use 1 as a placeholder system user
    authorizerPersonId = 1;
    entererPersonId = 1;
  }

  return { authorizerPersonId, entererPersonId };
}

// reftitle, or for a whole book with no reftitle its pubtitle, verbatim.
export function mapTitle(ref, referenceTypeName) {
  const reftitle = ref.reftitle ? ref.reftitle.trim() : '';
  if (reftitle) return reftitle;
  const pubtitle = ref.pubtitle ? ref.pubtitle.trim() : '';
  if (pubtitle && PUBTITLE_TITLE_TYPES.has(referenceTypeName)) return pubtitle;
  return null;
}

const isPubtitleTitle = (ref, referenceTypeName) =>
  !(ref.reftitle && ref.reftitle.trim()) && !!mapTitle(ref, referenceTypeName);

// A "book" with two titles and no editors stays a standalone book, which has no
// field for its container. Its pubtitle, pubvol and pubno go into comments.
export function containerNote(ref, editors) {
  if (ref.publication_type !== 'book' || editors || !hasTwoTitles(ref)) return null;
  const pubvol = (ref.pubvol ?? '').trim();
  const pubno = (ref.pubno ?? '').trim();
  let note = `Published in: ${ref.pubtitle.trim()}`;
  if (pubvol) note += `, vol. ${pubvol}`;
  if (pubno) note += `, no. ${pubno}`;
  return note;
}

export function buildComments(ref, note) {
  const comments = (ref.comments ?? '').trim();
  if (comments && note) return `${comments}; ${note}`;
  return comments || note || null;
}

export function buildJsonb(ref, authors, editors, pubType, pages, pubtitleFields, volNoFields, language, note = null) {
  const jsonb = {};

  jsonb.publicationType = pubType.referenceTypeName;
  const title = mapTitle(ref, pubType.referenceTypeName);
  if (title) {
    jsonb.title = title;
  } else {
    console.warn(`  WARNING: reference_no=${ref.reference_no} has NULL/empty reftitle`);
  }

  if (authors.length > 0) jsonb.authors = authors;
  if (ref.pubyr && ref.pubyr.trim()) jsonb.publicationYear = ref.pubyr.trim();
  if (pages) jsonb.pages = pages;
  if (ref.doi && ref.doi.trim()) jsonb.doi = ref.doi.trim();
  jsonb.language = language;
  jsonb.legacyIDs = { oldpbdbID: String(ref.reference_no) };

  // Type-specific fields
  Object.assign(jsonb, pubtitleFields);
  Object.assign(jsonb, volNoFields);

  if (pubType.bookType) jsonb.bookType = pubType.bookType;
  if (editors) jsonb.editors = editors;

  // Publisher/city for applicable types
  if (ref.publisher && ref.publisher.trim()) {
    jsonb.publisher = ref.publisher.trim();
  }
  if (ref.pubcity && ref.pubcity.trim()) {
    jsonb.publicationCity = ref.pubcity.trim();
  }

  const comments = buildComments(ref, note);
  if (comments) jsonb.comments = comments;

  return jsonb;
}

// --- Single-title books review list ---
// Classic records nothing that tells an edited volume from an authored book, so
// curators correct such refs after migration. The list helps them find these refs. It
// covers the single-title "book/book chapter" refs reclassified as standalone books,
// and single-title "book" refs with editors, the route edited volumes arrive by.
// The signals are unverified hints; no mapping depends on them.

const REVIEW_FILE = join(dirname(fileURLToPath(import.meta.url)), 'single-title-books-review.csv');
const REVIEW_HEADER = 'reference_no,permid,classic_type,authors,editors,year,title,pages,signals';

export function inReviewGroup(ref, editors) {
  if (hasTwoTitles(ref)) return false;
  return ref.publication_type === 'book/book chapter' || (ref.publication_type === 'book' && !!editors);
}

const normTitle = (s) => (s ?? '').trim().toLowerCase();
const EDITED_VOLUME_TITLE = /proceedings|symposium|congress|conference|festschrift|in hono(?:u)?r/i;
const EDITOR_WORD = /\b(?:eds?\.|editors?\b|edited\b)/i;

// Spec order. Each test takes (ref, jsonb, editors, lookups).
const REVIEW_SIGNALS = [
  ['chapter-missing-title', (ref, j, ed) => !!ed && (!j.title || /^in[ :]/i.test(j.title))],
  ['multi-author-no-editors', (ref, j, ed) => !ed && (j.authors?.length ?? 0) >= 2],
  ['pubtitle-is-book-title', (ref, j, ed, l) => !!normTitle(ref.pubtitle) && l.bookTitles.has(normTitle(ref.pubtitle))],
  ['pubtitle-is-journal-title', (ref, j, ed, l) => !!normTitle(ref.pubtitle) && l.journalTitles.has(normTitle(ref.pubtitle))],
  ['first-page-after-1', (ref, j) => (j.pages?.first ?? 0) > 1],
  ['edited-volume-words', (ref, j) => EDITED_VOLUME_TITLE.test(j.title ?? '')
    || EDITOR_WORD.test(j.title ?? '') || EDITOR_WORD.test(ref.comments ?? '')],
  ['book-with-editors', (ref) => ref.publication_type === 'book'],
];
export const REVIEW_SIGNAL_NAMES = REVIEW_SIGNALS.map(([name]) => name);

// The names of the signals a ref matches, in spec order; none outside the review group.
// lookups: { bookTitles, journalTitles }, trimmed and lowercased.
export function reviewSignals(ref, jsonb, editors, lookups) {
  if (!inReviewGroup(ref, editors)) return [];
  return REVIEW_SIGNALS.filter(([, matches]) => matches(ref, jsonb, editors, lookups)).map(([name]) => name);
}

function reviewPages(ref, jsonb) {
  if (jsonb.pages) return `${jsonb.pages.first}–${jsonb.pages.last}`;
  return [ref.firstpage, ref.lastpage].map((p) => (p ?? '').trim()).filter(Boolean).join('–');
}

// One CSV line of the review list.
export function reviewRow(ref, jsonb, permid, signals) {
  return [
    ref.reference_no,
    permid,
    ref.publication_type,
    (jsonb.authors ?? []).map((a) => a.familyName).join('; '),
    jsonb.editors ?? '',
    jsonb.publicationYear ?? '',
    jsonb.title ?? '',
    reviewPages(ref, jsonb),
    signals.join('; '),
  ].map(csvField).join(',');
}

// --- Main ---

async function main() {
  const startTime = new Date();
  console.log(`[${startTime.toISOString()}] Starting refs migration...`);

  // Resolved before any source row is read, so an empty dictionary aborts up front.
  const validate = createAjv().compile(deriveVariant(await resolveEnums(pg, referenceSource), 'db'));
  console.log('  Resolved and compiled the reference db variant');

  // 2.1 Read all refs
  const [refs] = await mariadb.query(
    `SELECT reference_no, authorizer_no, enterer_no,
            author1init, author1last, author2init, author2last, otherauthors,
            pubyr, reftitle, pubtitle, editors, publisher, pubcity,
            pubvol, pubno, firstpage, lastpage,
            publication_type, language, doi, comments
     FROM refs`
  );
  console.log(`  Read ${refs.length} rows from MariaDB refs`);

  // 2.2 Read ref_authors, group by reference_no
  const [rawAuthors] = await mariadb.query(
    `SELECT reference_no, place, lastname, firstname FROM ref_authors ORDER BY reference_no, place`
  );
  const refAuthorsMap = new Map();
  for (const row of rawAuthors) {
    if (!refAuthorsMap.has(row.reference_no)) refAuthorsMap.set(row.reference_no, []);
    refAuthorsMap.get(row.reference_no).push(row);
  }
  console.log(`  Read ${rawAuthors.length} ref_authors rows (${refAuthorsMap.size} references)`);

  // 2.3 Read ref_editors, group by reference_no
  const [rawEditors] = await mariadb.query(
    `SELECT reference_no, place, lastname, firstname FROM ref_editors ORDER BY reference_no, place`
  );
  const refEditorsMap = new Map();
  for (const row of rawEditors) {
    if (!refEditorsMap.has(row.reference_no)) refEditorsMap.set(row.reference_no, []);
    refEditorsMap.get(row.reference_no).push(row);
  }
  console.log(`  Read ${rawEditors.length} ref_editors rows (${refEditorsMap.size} references)`);

  // 5.1 Transform all rows
  const pubTypeCounts = {};
  let nonNumericPageCount = 0;
  let pageZeroCount = 0;
  let pubtitleTitleCount = 0;
  const titleRuleCounts = { 'book/book chapter': 0, book: 0 };
  let singleTitleBookCount = 0;
  let containerNoteCount = 0;
  let warningCount = 0;
  // Refs in the review group, and the title sets two of its signals compare against.
  const reviewCandidates = [];
  const bookTitles = new Set();
  const journalTitles = new Set();

  const targetRows = refs.map((ref) => {
    const authors = buildAuthors(ref, refAuthorsMap);
    const editors = buildEditors(ref, refEditorsMap);
    // Editors first: the "book" title rule depends on them.
    const pubType = mapPublicationType(ref, editors);
    pubTypeCounts[pubType.referenceTypeName] = (pubTypeCounts[pubType.referenceTypeName] || 0) + 1;
    if (classifyByTitles(ref, editors)) titleRuleCounts[ref.publication_type]++;
    else if (ref.publication_type === 'book/book chapter') singleTitleBookCount++;
    const note = containerNote(ref, editors);
    if (note) containerNoteCount++;

    const pubtitleFields = mapPubtitle(ref, pubType.referenceTypeName);
    const volNoFields = mapVolNo(ref, pubType.referenceTypeName);
    const pages = buildPages(ref.firstpage, ref.lastpage);
    if (!pages && ref.firstpage && ref.firstpage.trim()) {
      console.warn(`  WARNING: reference_no=${ref.reference_no} non-numeric pages: firstpage='${ref.firstpage}' lastpage='${ref.lastpage}'`);
      nonNumericPageCount++;
      warningCount++;
    }
    if (pages && parseInt(ref.firstpage.trim(), 10) === 0) {
      console.warn(`  WARNING: reference_no=${ref.reference_no} firstpage=0 written as 1`);
      pageZeroCount++;
    }
    if (isPubtitleTitle(ref, pubType.referenceTypeName)) {
      console.log(`  reference_no=${ref.reference_no} title taken from pubtitle`);
      pubtitleTitleCount++;
    }
    const language = mapLanguage(ref.language);
    const { authorizerPersonId, entererPersonId } = mapPersonIds(ref);

    const jsonb = buildJsonb(ref, authors, editors, pubType, pages, pubtitleFields, volNoFields, language, note);
    // PBDB refs keep fields their type would not allow on create: the db variant
    // applies no per-type rule, and those fields are bibliographic history.
    if (!validate(jsonb)) {
      console.error(`  Validation failed for reference_no=${ref.reference_no}`);
      console.error(JSON.stringify(validate.errors, null, 2));
      console.error(JSON.stringify(jsonb, null, 2));
      throw new Error('payload failed reference db-schema validation');
    }
    if (jsonb.bookTitle) bookTitles.add(normTitle(jsonb.bookTitle));
    if (jsonb.journalTitle) journalTitles.add(normTitle(jsonb.journalTitle));
    if (inReviewGroup(ref, editors)) reviewCandidates.push({ ref, jsonb, editors });

    return {
      id: ref.reference_no,
      authorizer_person_id: authorizerPersonId,
      enterer_person_id: entererPersonId,
      reference: jsonb,
      preceded_by_id: null,
      succeeded_by_id: null,
      removed: false,
    };
  });

  console.log(`  Transformed ${targetRows.length} rows`);

  // 5.2 Batched upsert. A row's permid is REF-<reference_no>-<CC>, registered in
  // the batch's transaction for the rows this run creates; a row that already
  // exists keeps its permid (the upsert never writes it).
  const { rows: existing } = await pg.query(`SELECT id, permid FROM refs`);
  const permidById = new Map(existing.map((r) => [Number(r.id), r.permid]));

  const BATCH_SIZE = 500;
  let upsertCount = 0;
  const client = await pg.connect();
  try {
    for (let i = 0; i < targetRows.length; i += BATCH_SIZE) {
      const batch = targetRows.slice(i, i + BATCH_SIZE);
      const values = [];
      const params = [];
      let paramIdx = 1;

      await client.query('BEGIN');
      const newIds = batch.map((row) => row.id).filter((id) => !permidById.has(id));
      const newPermids = await registerPermids(client, 'REF', newIds);
      newIds.forEach((id, k) => permidById.set(id, newPermids[k]));

      for (const row of batch) {
        values.push(
          `($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5}, $${paramIdx + 6}, $${paramIdx + 7})`
        );
        params.push(
          row.id,
          permidById.get(row.id),
          row.authorizer_person_id,
          row.enterer_person_id,
          JSON.stringify(row.reference),
          row.preceded_by_id,
          row.succeeded_by_id,
          row.removed,
        );
        paramIdx += 8;
      }

      await client.query(
        `INSERT INTO refs (id, permid, authorizer_person_id, enterer_person_id, reference, preceded_by_id, succeeded_by_id, removed)
         VALUES ${values.join(', ')}
         ON CONFLICT (id) DO UPDATE SET
           authorizer_person_id = EXCLUDED.authorizer_person_id,
           enterer_person_id = EXCLUDED.enterer_person_id,
           reference = EXCLUDED.reference,
           preceded_by_id = EXCLUDED.preceded_by_id,
           succeeded_by_id = EXCLUDED.succeeded_by_id,
           removed = EXCLUDED.removed`,
        params
      );
      await client.query('COMMIT');

      upsertCount += batch.length;
      if ((i / BATCH_SIZE) % 20 === 0) {
        console.log(`  Upserted ${upsertCount}/${targetRows.length} rows...`);
      }
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  console.log(`  Upserted ${upsertCount} rows into references`);

  // 5.3 Reset identity sequence
  await pg.query(
    `SELECT setval(pg_get_serial_sequence('refs', 'id'), (SELECT MAX(id) FROM refs))`
  );
  console.log('  Identity sequence reset');

  // 5.4 Review list, after the upsert so every row has its permid.
  const lookups = { bookTitles, journalTitles };
  const reviewByType = { 'book/book chapter': 0, book: 0 };
  const signalCounts = Object.fromEntries(REVIEW_SIGNAL_NAMES.map((name) => [name, 0]));
  const reviewLines = [];
  for (const { ref, jsonb, editors } of reviewCandidates.sort((a, b) => a.ref.reference_no - b.ref.reference_no)) {
    const signals = reviewSignals(ref, jsonb, editors, lookups);
    if (signals.length === 0) continue;
    reviewByType[ref.publication_type]++;
    for (const name of signals) signalCounts[name]++;
    reviewLines.push(reviewRow(ref, jsonb, permidById.get(ref.reference_no), signals));
  }
  writeFileSync(REVIEW_FILE, [REVIEW_HEADER, ...reviewLines].join('\n') + '\n');

  // 6.1 Row count verification
  const { rows: countResult } = await pg.query(`SELECT COUNT(*)::int AS count FROM refs`);
  const pgCount = countResult[0].count;

  if (pgCount === refs.length) {
    console.log(`  Verification PASSED: ${pgCount} rows in PostgreSQL matches ${refs.length} source rows`);
  } else {
    console.warn(`  Verification WARNING: PostgreSQL has ${pgCount} rows but source had ${refs.length} rows`);
    warningCount++;
  }

  // 6.2 Publication type mapping summary
  console.log('  Publication type mapping summary:');
  for (const [type, count] of Object.entries(pubTypeCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${type}: ${count}`);
  }

  // 6.3 Overall summary
  const endTime = new Date();
  const elapsed = ((endTime - startTime) / 1000).toFixed(1);
  console.log(`  Non-numeric page warnings: ${nonNumericPageCount}`);
  console.log(`  First page 0 written as 1: ${pageZeroCount}`);
  console.log(`  Titles taken from pubtitle: ${pubtitleTitleCount}`);
  console.log(`  "book/book chapter" → article in edited collection by titles: ${titleRuleCounts['book/book chapter']}`);
  console.log(`  "book" → article in edited collection by titles and editors: ${titleRuleCounts.book}`);
  console.log(`  "book/book chapter" → standalone book for lacking two titles: ${singleTitleBookCount}`);
  console.log(`  Container notes written to comments: ${containerNoteCount}`);
  console.log(`  Single-title books review list: ${reviewLines.length} rows`
    + ` ("book/book chapter" ${reviewByType['book/book chapter']}, "book" ${reviewByType.book})`);
  for (const [name, count] of Object.entries(signalCounts)) console.log(`    ${name}: ${count}`);
  console.log(`  Total warnings: ${warningCount}`);
  console.log(`[${endTime.toISOString()}] Refs migration complete in ${elapsed}s`);
}

// Only run main() when invoked directly, so pure transforms can be imported for unit tests.
const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((err) => {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  }).finally(() => closeAll());
}
