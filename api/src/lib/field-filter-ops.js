/**
 * The match kinds a declared field filter can name in its `op`. Each kind is
 * defined once, with the part each stage of a filter needs:
 *
 *   schema      the parameter's JSON Schema beyond `{ type: 'string', minLength: 1 }`
 *               (query-schemas.js merges it in), or a function of the filter's
 *               declaration that returns it
 *   describe    the parameter's description in the API document, from the
 *               filter's `jsonPath` and its whole declaration
 *   parse       the validated string → what the predicate binds; throws a 400 for
 *               what the schema cannot express (list-filters.js calls it, before
 *               any query)
 *   predicate   the SQL fragment (repository.js composes it into the WHERE)
 *
 * A predicate receives `payload` (the quoted payload column), `key` (the quoted
 * JSONB key from the trusted descriptor) and `bind`, which pushes a value as a
 * query parameter and returns its `$n`; request values are only ever bound.
 *
 * LINK filters (`linkPermid`, `taxonExact`, `taxonSubtree`) match a column
 * holding a foreign key, not a payload field. Each takes one permid of the
 * declared `prefix`, enforced by its schema; they have no `predicate` here,
 * because the resource's own repository translates them (occurrence-repository.js).
 *
 * See openspec/changes/add-reference-shared-filters/design.md, D1–D6,
 * openspec/changes/add-reference-type-filters/design.md, D3 (`foldedEq`), and
 * openspec/changes/add-occurrence-reads/design.md, D8 (link filters).
 */

/** A leading DOI resolver URL or `doi:` label, removed from both sides of a `doi` match. */
const DOI_PREFIX = '^(https?://(dx\\.)?doi\\.org/|doi:)\\s*';
const DOI_PREFIX_RE = new RegExp(DOI_PREFIX, 'i');

/** `YYYY` or `YYYY-YYYY`. */
export const YEAR_PATTERN = '^\\d{4}(-\\d{4})?$';

/**
 * A permid of `prefix`: `<PREFIX>-<digits>-<two digits>`. Only the form: the
 * check digits are the database's business (cursor.js), so a well-formed permid
 * naming nothing matches nothing.
 *
 * @param {string} prefix
 */
export const permidPattern = (prefix) => `^${prefix}-\\d+-\\d{2}$`;

const PERMID_PATTERN = /^\^([A-Z]{3})-/;

/** Messages for a kind's `pattern` error, keyed by the pattern. */
const PATTERN_MESSAGES = {
  [YEAR_PATTERN]: (param) => `\`${param}\` must be a year (YYYY) or a range (YYYY-YYYY)`,
};

/**
 * The message for a `pattern` error on `param` (query-schemas.js `messageFor`),
 * or undefined for a pattern no kind declares.
 *
 * @param {string} pattern
 * @param {string} param
 */
export function patternMessage(pattern, param) {
  if (PATTERN_MESSAGES[pattern]) return PATTERN_MESSAGES[pattern](param);
  const prefix = PERMID_PATTERN.exec(pattern)?.[1];
  if (prefix && pattern === permidPattern(prefix)) {
    return `\`${param}\` must be a ${prefix} permid (${prefix}-<number>-<check digits>)`;
  }
  return undefined;
}

/** A link filter's schema: one permid of its declared prefix. */
const permidSchema = (def) => ({ pattern: permidPattern(def.prefix) });

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

  linkPermid: {
    schema: permidSchema,
    describe: (_jsonPath, { prefix, target }) =>
      `A ${prefix} permid. Only items linked to the item of \`${target}\` with this permid. ` +
      'A well-formed permid that names nothing matches nothing.',
    parse: (value) => value,
  },

  taxonExact: {
    schema: permidSchema,
    describe: (_jsonPath, { prefix }) =>
      `A ${prefix} permid. Only items identified as exactly this taxon name, as stored: not its ` +
      'synonyms, and nothing within it (see `withinTaxon`).',
    parse: (value) => value,
  },

  taxonSubtree: {
    schema: permidSchema,
    describe: (_jsonPath, { prefix }) =>
      `A ${prefix} permid. Only items identified as a taxon within this one: its accepted concept, ` +
      "every concept contained in it at any depth, and every name of each. A junior synonym's permid " +
      "selects its senior's whole subtree. Never matches an identification whose taxon was not derived.",
    parse: (value) => value,
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
