/**
 * RIS for references (ris-output; design D4–D7).
 *
 * One record per reference, tags in a fixed order, each omitted when its value
 * is absent or blank (except TY, ID, UR, DB and ER, which every record has).
 * The mapping follows the RIS specification and how Zotero's importer reads
 * each tag, not Classic's output; `docs/ris-output.md` lists the differences.
 *
 * Lines are `TAG  - value` + CRLF. A record ends `ER  - ` + CRLF and then a
 * blank line, so records concatenate without any per-response state.
 */

const EOL = '\r\n';

/** Publication type → RIS type; a standalone book is THES or BOOK by `bookType`. */
const TYPES = {
  'journal article': 'JOUR',
  'article in edited collection': 'CHAP',
  'edited collection': 'EDBOOK',
  'serial monograph': 'SER',
  'standalone book': 'BOOK',
  unpublished: 'UNPD',
  other: 'GEN',
};

const THESIS_BOOK_TYPES = new Set(['Ph.D. thesis', 'M.S. thesis']);

/**
 * Book types (D5, D6). Zotero reads `A2` on them as series editor, so editors
 * go in `A3`; it has no issue field for them, so the number goes in `M1`, which
 * it reads as the series number.
 */
const BOOK_TYPES = new Set(['SER', 'EDBOOK', 'BOOK', 'THES']);

/**
 * Types whose `SP` Zotero reads as the number of pages, dropping `EP` (D5):
 * the book types, and `UNPD`, which it imports as a manuscript.
 */
const PAGE_COUNT_TYPES = new Set([...BOOK_TYPES, 'UNPD']);

/** The RIS type of a reference. */
export function risType(record) {
  if (record.publicationType === 'standalone book' && THESIS_BOOK_TYPES.has(record.bookType)) return 'THES';
  return TYPES[record.publicationType] ?? 'GEN';
}

/**
 * A value as one line of text: a run of whitespace holding a CR or LF becomes
 * one space, and the result is trimmed. Null and absent become ''.
 */
function text(value) {
  if (value == null) return '';
  return String(value).replace(/\s*[\r\n]\s*/g, ' ').trim();
}

/** The first of `values` that is not blank, as text. */
const first = (...values) => values.map(text).find((v) => v !== '') ?? '';

/**
 * Pages as one `SP` value on a type whose `SP` is the number of pages: the last
 * page when the range starts at 1 (a page count), the page when there is one,
 * else `first-last`, so a range inside a volume is not lost.
 */
function pageCount({ first: f, last: l } = {}) {
  const firstPage = text(f);
  const lastPage = text(l);
  if (!lastPage || lastPage === firstPage) return firstPage;
  if (!firstPage || firstPage === '1') return lastPage;
  return `${firstPage}-${lastPage}`;
}

function author({ familyName, givenName } = {}) {
  const family = text(familyName);
  const given = text(givenName);
  if (family && given) return `${family}, ${given}`;
  return family || given;
}

/**
 * The RIS serializer for references.
 *
 * @param {object} _source  the payload source (unused: the mapping is fixed)
 * @param {{ baseHref: string }} opts  the references group's absolute URL
 * @returns {{ header: () => string, record: (r: object) => string }}
 */
export function risSerializer(_source, { baseHref } = {}) {
  return {
    header: () => '',
    record(r) {
      const lines = [];
      const tag = (name, value, always = false) => {
        const v = text(value);
        if (v !== '' || always) lines.push(`${name}  - ${v}`);
      };

      const ty = risType(r);
      tag('TY', ty, true);
      tag('ID', r.permid, true);
      tag('UR', `${baseHref}/${r.permid}`, true);
      tag('DB', 'Paleobiology Database', true);
      for (const a of r.authors ?? []) tag('AU', author(a));
      tag(BOOK_TYPES.has(ty) ? 'A3' : 'A2', r.editors);
      tag('PY', r.publicationYear);
      tag('TI', r.title);
      tag('T2', first(r.journalTitle, r.bookTitle, r.seriesTitle));
      if (ty === 'THES') tag('M3', r.bookType);
      tag('VL', first(r.journalVolume, r.seriesVolume));
      tag(BOOK_TYPES.has(ty) ? 'M1' : 'IS', first(r.journalNumber, r.seriesNumber));
      if (PAGE_COUNT_TYPES.has(ty)) {
        tag('SP', pageCount(r.pages));
      } else {
        tag('SP', r.pages?.first);
        if (text(r.pages?.last) !== text(r.pages?.first)) tag('EP', r.pages?.last);
      }
      tag('PB', r.publisher);
      tag('CY', r.publicationCity);
      tag('N1', r.comments);
      tag('N1', r.description);
      tag('LA', r.language);
      tag('DO', r.doi);
      lines.push('ER  - ');

      return lines.join(EOL) + EOL + EOL;
    },
  };
}
