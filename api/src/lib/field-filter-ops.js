/**
 * The match kinds a declared field filter can name in its `op`. Each kind is
 * defined once, with the part each stage of a filter needs:
 *
 *   schema      the parameter's JSON Schema beyond `{ type: 'string', minLength: 1 }`
 *               (query-schemas.js merges it in)
 *   describe    the parameter's description in the API document
 *   parse       the validated string → what the predicate binds; throws a 400 for
 *               what the schema cannot express (list-filters.js calls it, before
 *               any query)
 *   predicate   the SQL fragment (repository.js composes it into the WHERE)
 *
 * A predicate receives `payload` (the quoted payload column), `key` (the quoted
 * JSONB key from the trusted descriptor) and `bind`, which pushes a value as a
 * query parameter and returns its `$n`; request values are only ever bound.
 *
 * See openspec/changes/add-reference-shared-filters/design.md, D1–D6, and
 * openspec/changes/add-reference-type-filters/design.md, D3 (`foldedEq`).
 */

/** A leading DOI resolver URL or `doi:` label, removed from both sides of a `doi` match. */
const DOI_PREFIX = '^(https?://(dx\\.)?doi\\.org/|doi:)\\s*';
const DOI_PREFIX_RE = new RegExp(DOI_PREFIX, 'i');

/** `YYYY` or `YYYY-YYYY`. */
export const YEAR_PATTERN = '^\\d{4}(-\\d{4})?$';

/** Messages for a kind's `pattern` error, keyed by the pattern (query-schemas.js `messageFor`). */
export const PATTERN_MESSAGES = {
  [YEAR_PATTERN]: (param) => `\`${param}\` must be a year (YYYY) or a range (YYYY-YYYY)`,
};

/** Case- and accent-folded text, compared on both sides of a family-name match. */
const folded = (expression) => `lower(unaccent(${expression}))`;

/** {@link folded}, with each run of whitespace collapsed to one space first. */
const foldedSpaced = (expression) => folded(`regexp_replace(${expression}, '\\s+', ' ', 'g')`);

/** Escape `LIKE`'s wildcards and its escape character, so they match literally. */
const likeLiteral = (word) => word.replace(/[\\%_]/g, '\\$&');

export const FIELD_FILTER_OPS = {
  eq: {
    schema: {},
    describe: (jsonPath) => `Only items whose \`${jsonPath}\` equals this value.`,
    parse: (value) => value,
    predicate: ({ payload, key, bind }, value) => `${payload}->>${key} = ${bind(value)}`,
  },

  doi: {
    schema: {},
    describe: (jsonPath) =>
      `Only items whose \`${jsonPath}\` equals this DOI, ignoring case and a leading ` +
      '`https://doi.org/` or `doi:`. More than one item can share a DOI.',
    parse: (value, param, httpErrors) => {
      const doi = value.replace(DOI_PREFIX_RE, '').toLowerCase();
      if (!doi) throw httpErrors.badRequest(`\`${param}\` must contain a DOI after its prefix`);
      return doi;
    },
    predicate: ({ payload, key, bind }, doi) =>
      `lower(regexp_replace(${payload}->>${key}, ${bind(DOI_PREFIX)}, '', 'i')) = ${bind(doi)}`,
  },

  foldedEq: {
    schema: {},
    describe: (jsonPath) =>
      `Only items whose whole \`${jsonPath}\` equals this value, ignoring case, accents and runs of ` +
      'whitespace. Part of a longer value does not match.',
    parse: (value) => value,
    predicate: ({ payload, key, bind }, value) =>
      `${foldedSpaced(`${payload}->>${key}`)} = ${foldedSpaced(bind(value))}`,
  },

  allWords: {
    schema: {},
    describe: (jsonPath) =>
      `Only items whose \`${jsonPath}\` contains every word of this value, in any order, ` +
      'ignoring case and accents.',
    parse: (value) => [...new Set(value.split(/\s+/).filter(Boolean))],
    predicate: ({ payload, key, bind }, words) =>
      words
        .map((word) => `unaccent(${payload}->>${key}) ILIKE ('%' || unaccent(${bind(likeLiteral(word))}) || '%')`)
        .join(' AND '),
  },

  familyNames: {
    schema: {},
    describe: (jsonPath) =>
      `Comma-separated family names. Only items with, for each name, an entry in \`${jsonPath}\` ` +
      'whose `familyName` equals it, ignoring case and accents: every name must be present.',
    parse: (value, param, httpErrors) => {
      const names = value.split(',').map((name) => name.trim());
      if (names.some((name) => !name)) {
        throw httpErrors.badRequest(`\`${param}\` must not contain an empty name`);
      }
      return [...new Set(names)];
    },
    predicate: ({ payload, key, bind }, names) =>
      names
        .map(
          (name) =>
            `EXISTS (SELECT 1 FROM jsonb_array_elements(${payload}->${key}) a ` +
            `WHERE ${folded("a->>'familyName'")} = ${folded(bind(name))})`,
        )
        .join(' AND '),
  },

  firstFamilyName: {
    schema: {},
    describe: (jsonPath) =>
      `Only items whose first entry in \`${jsonPath}\` has this \`familyName\`, ignoring case and accents.`,
    parse: (value, param, httpErrors) => {
      if (value.includes(',')) {
        throw httpErrors.badRequest(`\`${param}\` takes one family name; use \`authors\` for several`);
      }
      return value;
    },
    predicate: ({ payload, key, bind }, name) =>
      `${folded(`${payload}->${key}->0->>'familyName'`)} = ${folded(bind(name))}`,
  },

  yearRange: {
    schema: { pattern: YEAR_PATTERN },
    describe: (jsonPath) =>
      `Only items whose \`${jsonPath}\` is this year (\`YYYY\`) or within this range ` +
      '(`YYYY-YYYY`, both years included, the earlier first).',
    parse: (value, param, httpErrors) => {
      const [from, to = from] = value.split('-').map(Number);
      if (from > to) {
        throw httpErrors.badRequest(`\`${param}\` range ${value} is reversed; write the earlier year first`);
      }
      return { from, to };
    },
    // The CASE guards the cast: an AND's operands may run in any order, and a
    // stored year need not be digits. A year that is not four digits is NULL.
    predicate: ({ payload, key, bind }, { from, to }) =>
      `(CASE WHEN ${payload}->>${key} ~ '^[0-9]{4}$' THEN (${payload}->>${key})::int END) ` +
      `BETWEEN ${bind(from)} AND ${bind(to)}`,
  },
};

/**
 * The match kind a filter declares, or a thrown error naming it: an unknown
 * `op` is a descriptor mistake, caught when the routes and repository are built.
 *
 * @param {string} op
 */
export function filterOp(op) {
  const kind = FIELD_FILTER_OPS[op];
  if (!kind) throw new Error(`Unknown field-filter op '${op}'`);
  return kind;
}
