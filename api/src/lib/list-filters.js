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
 * - unrecognized params are ignored (lenient; also provisional)
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
 * @returns {{ ids?: string[], fields?: Record<string, string>,
 *   page: { limit: number, cursor?: { permid: string, direction: 'next'|'prev' } } }}
 */
export function collectListFilters(query, httpErrors, filterDefs = {}) {
  const filters = {};

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

  filters.page = collectPage(query, httpErrors, 'ids' in query);

  return filters;
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
