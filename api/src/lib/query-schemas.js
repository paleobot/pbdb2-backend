/**
 * Querystring schemas for the GET routes, and the two pieces that make
 * Fastify's validation of them behave as the hand-written checks did: a
 * `preValidation` normalizer and an error formatter.
 *
 * A route's querystring schema is built from what the resource declares (its
 * descriptor's `filters` and `expansions`, and the payload source for a
 * filter's legal values), so the parameters the API description lists are the
 * parameters the route enforces. Fastify validates every request against it
 * with the backend's own Ajv (`createAjv`, configured in app.js): no stripping
 * of unknown parameters, all errors reported, no defaults applied.
 *
 * What JSON Schema cannot express stays in `collectListFilters`
 * (list-filters.js): cursor decoding, the cap on distinct ids after splitting,
 * and the default `limit`. Each rule lives in exactly one of the two places.
 *
 * See openspec/changes/add-openapi-for-reads/design.md, D1 and D11.
 */

import { MAX_IDS, MAX_LIMIT, DEFAULT_LIMIT } from './list-filters.js';

/** The universal list parameters. No `default`: Ajv must not invent a `limit` before the `ids` rule reads it. */
const UNIVERSAL_PROPERTIES = {
  ids: {
    type: 'string',
    // At least one character that is not a separator, so `?ids=` and `?ids=,` fail here.
    pattern: '[^\\s,]',
    description:
      `Comma-separated permids: a multi-entity read. At most ${MAX_IDS} distinct permids. ` +
      'Cannot be combined with `limit` or `cursor`: the result is a single page.',
  },
  limit: {
    type: 'integer',
    minimum: 1,
    maximum: MAX_LIMIT,
    description: `Page size, ${DEFAULT_LIMIT} when absent. A larger value is rejected, never clamped.`,
  },
  cursor: {
    type: 'string',
    description: 'Opaque page token. Obtain it from `links.next` or `links.prev`; do not construct it.',
  },
};

/** `ids` excludes the pagination parameters: a multi-entity read is one page. */
const IDS_EXCLUDE = {
  ids: { type: 'object', properties: { limit: false, cursor: false } },
};

/**
 * The querystring schema of a list read.
 *
 * @param {object} [opts]
 * @param {Record<string, { jsonPath: string }>} [opts.filters]  the descriptor's field filters
 * @param {object} [opts.source]  the payload source, whose inline `enum` on a
 *   filter's field becomes the filter's legal values
 * @param {Record<string, { type: 'boolean' }>} [opts.expansions]  declared expansions
 */
export function listQuerySchema({ filters = {}, source, expansions = {} } = {}) {
  const properties = { ...UNIVERSAL_PROPERTIES };
  for (const [param, def] of Object.entries(filters)) {
    const values = source?.properties?.[def.jsonPath]?.enum;
    properties[param] = {
      type: 'string',
      minLength: 1,
      ...(Array.isArray(values) ? { enum: [...values] } : {}),
      description: `Only items whose \`${def.jsonPath}\` equals this value.`,
    };
  }
  for (const [param, def] of Object.entries(expansions)) {
    properties[param] = { type: def.type, description: 'Opt-in response content: `true` or `false`.' };
  }
  return { type: 'object', properties, additionalProperties: false, dependentSchemas: IDS_EXCLUDE };
}

/** A single read declares no query parameters today, so it accepts none. */
export const SINGLE_QUERY_SCHEMA = { type: 'object', properties: {}, additionalProperties: false };

/** The `:permid` path parameter of a single read. */
export const PERMID_PARAMS_SCHEMA = {
  type: 'object',
  properties: { permid: { type: 'string', description: 'The permid of the resource' } },
  required: ['permid'],
};

/**
 * `preValidation` hook: normalize the query before Ajv sees it, where plain
 * coercion would loosen a rule.
 *
 * - A declared parameter given more than once is a 400: the description states
 *   one value per parameter, and `?ids=a&ids=b` working was an accident.
 *   An undeclared one is left for Ajv to name as unrecognized.
 * - Every value is trimmed, so `publicationType= standalone book ` matches.
 * - An integer parameter must be a bare digit string: Ajv's coercion goes
 *   through `Number`, which accepts `1e3`, `0x10` and `1.0`.
 */
export async function normalizeQuery(request) {
  const properties = request.routeOptions.schema?.querystring?.properties;
  if (!properties) return;
  const { httpErrors } = request.server;

  for (const [param, value] of Object.entries(request.query)) {
    if (!(param in properties)) {
      if (typeof value === 'string') request.query[param] = value.trim();
      continue;
    }
    if (Array.isArray(value)) {
      throw httpErrors.badRequest(`\`${param}\` must be sent once, with a single value`);
    }
    const trimmed = value.trim();
    if (properties[param].type === 'integer' && !/^\d+$/.test(trimmed)) {
      throw httpErrors.badRequest(`\`${param}\` must be a positive integer`);
    }
    request.query[param] = trimmed;
  }
}

const PAGINATION = ['limit', 'cursor'];

/** The parameter an Ajv error is about: `/limit` → `limit`. */
const paramOf = (error) => error.instancePath.split('/')[1];

/**
 * Message for one querystring error, in the wording the hand checks used.
 * `error.parentSchema` is present because the querystring Ajv runs `verbose`.
 */
function messageFor(error) {
  const param = paramOf(error);
  switch (error.keyword) {
    case 'enum':
      return `\`${param}\` must be one of: ${error.params.allowedValues.join(', ')}`;
    case 'minLength':
      return `\`${param}\` must have a value`;
    case 'pattern':
      return param === 'ids' ? '`ids` must contain at least one id' : `\`${param}\` must have a value`;
    case 'maximum':
      return `\`${param}\` accepts at most ${error.params.limit}`;
    case 'type':
      if (error.params.type === 'boolean') return `\`${param}\` must be exactly \`true\` or \`false\``;
      if (error.params.type === 'integer') return `\`${param}\` must be a positive integer`;
      return `\`${param}\` must be a ${error.params.type}`;
    case 'minimum':
      return `\`${param}\` must be a positive integer`;
    default:
      return `\`${param}\` ${error.message}`;
  }
}

/**
 * Fastify's schema error formatter: turn Ajv's errors into the one 400 the hand
 * checks gave, through `httpErrors.badRequest` so the error is a
 * `BadRequestError` in the standard shape.
 *
 * Precedence follows the old checks: unrecognized parameters (all of them, from
 * `allErrors`), then `ids` combined with pagination, then the first error on
 * any other parameter, then pagination.
 *
 * @param {import('fastify').FastifyInstance['httpErrors']} httpErrors
 * @param {import('ajv').ErrorObject[]} errors
 * @param {string} dataVar  the request part: `querystring`, `params`, …
 */
export function formatQueryErrors(httpErrors, errors, dataVar) {
  const unknown = errors.filter((e) => e.keyword === 'additionalProperties');
  if (unknown.length > 0) {
    const names = unknown.map((e) => e.params.additionalProperty);
    const accepted = Object.keys(unknown[0].parentSchema.properties ?? {});
    return httpErrors.badRequest(
      `Unrecognized query parameter${names.length > 1 ? 's' : ''}: \`${names.join('`, `')}\`. ` +
        (accepted.length > 0
          ? `This resource accepts \`${accepted.join('`, `')}\``
          : 'This resource accepts no query parameters'),
    );
  }

  const combined = errors.filter((e) => e.schemaPath.startsWith('#/dependentSchemas/ids/'));
  if (combined.length > 0) {
    const sent = combined.map(paramOf);
    return httpErrors.badRequest(
      `\`ids\` cannot be combined with \`${sent.join('`/`')}\`: a multi-entity read is a single page`,
    );
  }

  // Pagination was checked last by hand, so a bad filter value outranks it; and
  // an empty value is reported as empty, not as outside the enum.
  const param = paramOf(errors.find((e) => !PAGINATION.includes(paramOf(e))) ?? errors[0]);
  const own = errors.filter((e) => paramOf(e) === param);
  const first = own.find((e) => e.keyword === 'minLength' || e.keyword === 'pattern') ?? own[0];
  if (dataVar !== 'querystring' || !first.instancePath) {
    return httpErrors.badRequest(`${dataVar}${first.instancePath} ${first.message}`);
  }
  return httpErrors.badRequest(messageFor(first));
}
