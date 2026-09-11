/**
 * The list-endpoint query-filter seam. Every list filter is parsed and
 * validated here, then handed to the route handler as a normalized object —
 * so a new filter is a contributor to this function, not a fresh branch bolted
 * onto the handler. Its contributors are `ids` (the multi-entity read), the
 * resource's declared field filters, and pagination (`limit` / `cursor`).
 *
 * This is the `validate` stage of the filter pipeline. Only request-derived
 * checks live here (the cheap ones that need no database). It runs before any
 * query, so a malformed request never reaches the repository. The `define`
 * stage is the resource's declared filters (passed as `filterDefs`); the
 * `translate` stage — turning a filter into a SQL predicate — lives in the
 * repository.
 */

import { decodeCursor } from './cursor.js';

/** Query parameters every list endpoint accepts, regardless of resource. */
export const UNIVERSAL_PARAMS = ['ids', 'limit', 'cursor'];

/** Max distinct ids accepted by a single multi-entity read. */
export const MAX_IDS = 100;

/** Page size for a list request that sends no `limit` (matches {@link MAX_IDS}). */
export const DEFAULT_LIMIT = 100;

/** Largest `limit` a client may ask for; above this is a 400, never a clamp. */
export const MAX_LIMIT = 1000;

/**
 * Parse `request.query` into a normalized filter object.
 *
 * `ids` (multi-entity read):
 * - absent → no `ids` key (caller lists all heads)
 * - present but empty / whitespace / splits to zero ids → 400
 * - more than {@link MAX_IDS} distinct ids → 400
 *
 * `permid`s are opaque strings, so there is no per-id syntactic validation: an
 * unknown id is simply absent from the result (reported as `missing` at the
 * route boundary), never rejected here. Duplicates collapse to a distinct set;
 * request order is not preserved.
 *
 * Field filters (per-entity, from `filterDefs`):
 * - a declared param present with a value → narrows by that JSONB field
 * - present with an empty value → 400 (mirrors the `ids` rule)
 * - values are opaque strings — NO enum validation (provisional; an
 *   enum-bearing JSON Schema will later be able to reject out-of-enum values)
 * - unrecognized params are REJECTED with a 400 naming them (see
 *   `rejectUnknownParams` for why this is strict rather than lenient)
 *
 * Expansions (per-entity, from `expansionDefs`):
 * - a declared param with `true` / `false` → opt-in response content
 * - any other value, including the bare valueless form → 400
 * - permitted alongside `ids`, unlike `limit`/`cursor`: a multi-entity read is a
 *   list and carries list semantics, so it opts into the same expansions
 *
 * Pagination (`limit` / `cursor`):
 * - `limit` absent → {@link DEFAULT_LIMIT}; empty, non-integer, zero, negative,
 *   or above {@link MAX_LIMIT} → 400. An oversized limit is REJECTED rather than
 *   clamped: a silent clamp leaves a client believing it has seen more of the
 *   result set than it has, which surfaces as missing data much later.
 * - `cursor` absent → no cursor (first page); present but undecodable → 400.
 * - `ids` combined with either → 400. The multi-entity read is bounded by
 *   {@link MAX_IDS} and is inherently one page, and its `missing` accounting
 *   would become incoherent under slicing (absent from this page, or absent
 *   entirely?). Stating the incompatibility beats resolving it silently in a
 *   direction the client did not choose.
 *
 * @param {Record<string, unknown>} query  `request.query`
 * @param {import('fastify').FastifyInstance['httpErrors']} httpErrors
 *   `fastify.httpErrors` (from @fastify/sensible)
 * @param {Record<string, { jsonPath: string, op: string }>} [filterDefs]
 *   the resource's declared field filters (its `define` stage)
 * @param {Record<string, { type: 'boolean' }>} [expansionDefs]
 *   the resource's declared expansion parameters
 * @returns {{ ids?: string[], fields?: Record<string, string>,
 *   expansions?: Record<string, boolean>,
 *   page: { limit: number, cursor?: { permid: string, direction: 'next'|'prev' } } }}
 */
export function collectListFilters(query, httpErrors, filterDefs = {}, expansionDefs = {}) {
  const filters = {};

  rejectUnknownParams(query, httpErrors, [
    ...UNIVERSAL_PARAMS,
    ...Object.keys(filterDefs),
    ...Object.keys(expansionDefs),
  ]);

  // `'ids' in query` is what distinguishes `?ids=` (present, empty → 400) from
  // an absent `ids` (list everything) — the two are deliberately not the same.
  if ('ids' in query) {
    const ids = [
      ...new Set(
        String(query.ids)
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean),
      ),
    ];

    if (ids.length === 0) {
      throw httpErrors.badRequest('`ids` must contain at least one id');
    }
    if (ids.length > MAX_IDS) {
      throw httpErrors.badRequest(`\`ids\` accepts at most ${MAX_IDS} ids`);
    }

    filters.ids = ids;
  }

  // Per-entity field filters: only params this resource declares are recognized;
  // everything else falls through untouched (lenient — see provisional note).
  const fields = {};
  for (const param of Object.keys(filterDefs)) {
    if (param in query) {
      const value = String(query[param]).trim();
      if (value === '') {
        throw httpErrors.badRequest(`\`${param}\` must have a value`);
      }
      fields[param] = value;
    }
  }
  if (Object.keys(fields).length > 0) {
    filters.fields = fields;
  }

  const expansions = collectExpansions(query, httpErrors, expansionDefs);
  if (expansions) {
    filters.expansions = expansions;
  }

  filters.page = collectPage(query, httpErrors, 'ids' in query);

  return filters;
}

/**
 * Reject any query parameter the resource does not recognize, with a 400 naming
 * it. This applies to single reads as well as lists (see `rejectUnknownQuery`).
 *
 * This REPLACES the previous leniency, under which an unrecognized parameter was
 * ignored. The reason is specific to this API rather than general strictness: a
 * silently ignored parameter produces a response indistinguishable from a
 * correct one. `?includeContainingTax=true` yields a taxon with no chain, which
 * reads exactly like a taxon with no ancestors; a misspelled field filter yields
 * an unfiltered list, which reads exactly like everything matching. On a
 * scientific database, a wrong answer that looks right is worse than an error.
 *
 * It is the same reasoning that already rejects an oversized `limit` rather than
 * clamping it: silence surfaces as missing data much later.
 *
 * Filter VALUES stay opaque — a well-formed value matching nothing still yields
 * an empty 200. Only parameter NAMES are validated here.
 *
 * @param {Record<string, unknown>} query
 * @param {import('fastify').FastifyInstance['httpErrors']} httpErrors
 * @param {string[]} recognized
 */
function rejectUnknownParams(query, httpErrors, recognized) {
  const known = new Set(recognized);
  const unknown = Object.keys(query).filter((param) => !known.has(param));

  if (unknown.length > 0) {
    throw httpErrors.badRequest(
      `Unrecognized query parameter${unknown.length > 1 ? 's' : ''}: ` +
        `\`${unknown.join('`, `')}\`. This resource accepts \`${recognized.join('`, `')}\``,
    );
  }
}

/**
 * Validate a single read's query parameters. A single read takes no filters and
 * no pagination, so it recognizes only what the resource declares as expansions
 * — today, nothing on any resource, since the taxa chain is unconditional on a
 * single read.
 *
 * Without this, strictness would differ by endpoint shape: an unknown parameter
 * would be a 400 on a list and silently ignored on a single read.
 *
 * @param {Record<string, unknown>} query  `request.query`
 * @param {import('fastify').FastifyInstance['httpErrors']} httpErrors
 * @param {string[]} [recognized]  parameters this single read accepts
 */
export function rejectUnknownQuery(query, httpErrors, recognized = []) {
  rejectUnknownParams(query, httpErrors, recognized);
}

/**
 * Parse declared expansion parameters into `{ <param>: boolean }`, or undefined
 * when the request asks for none.
 *
 * Expansions are opt-in response content, not filters: they widen what each
 * record carries rather than narrowing which records are returned. Today the
 * only one is the taxa containing-chain.
 *
 * Values are strictly `true` or `false` — matching `limit`'s strictness, and
 * rejecting the bare valueless form, which is genuinely ambiguous (presence as
 * truth, or an empty value?). Stating it beats resolving it in a direction the
 * client did not choose.
 */
function collectExpansions(query, httpErrors, expansionDefs) {
  const expansions = {};

  for (const param of Object.keys(expansionDefs)) {
    if (!(param in query)) continue;

    const raw = String(query[param]).trim();
    if (raw !== 'true' && raw !== 'false') {
      throw httpErrors.badRequest(`\`${param}\` must be exactly \`true\` or \`false\``);
    }
    expansions[param] = raw === 'true';
  }

  return Object.keys(expansions).length > 0 ? expansions : undefined;
}

/**
 * Parse the pagination parameters into `{ limit, cursor? }`. Always returns a
 * `limit`, so no list read is unbounded even when the client sends nothing.
 */
function collectPage(query, httpErrors, hasIds) {
  const paginating = ['limit', 'cursor'].filter((param) => param in query);
  if (hasIds && paginating.length > 0) {
    throw httpErrors.badRequest(
      `\`ids\` cannot be combined with \`${paginating.join('`/`')}\`: a multi-entity read is a single page`,
    );
  }

  const page = { limit: DEFAULT_LIMIT };

  if ('limit' in query) {
    const raw = String(query.limit).trim();
    // A bare integer only: `Number` would accept '1e3', ' 10 ', '0x10' and '1.0'.
    if (!/^\d+$/.test(raw)) {
      throw httpErrors.badRequest('`limit` must be a positive integer');
    }
    const limit = Number(raw);
    if (limit === 0) {
      throw httpErrors.badRequest('`limit` must be a positive integer');
    }
    if (limit > MAX_LIMIT) {
      throw httpErrors.badRequest(`\`limit\` accepts at most ${MAX_LIMIT}`);
    }
    page.limit = limit;
  }

  if ('cursor' in query) {
    const cursor = decodeCursor(String(query.cursor).trim());
    if (!cursor) {
      throw httpErrors.badRequest('`cursor` is not a valid cursor; follow `links.next`/`links.prev`');
    }
    page.cursor = cursor;
  }

  return page;
}
