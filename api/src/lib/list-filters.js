/**
 * The list-endpoint query-filter seam. Every list filter is turned into a
 * normalized object here and handed to the route handler, so a new filter is a
 * contributor to this function, not a branch bolted onto the handler. Its
 * contributors are `ids` (the multi-entity read), the resource's declared field
 * filters (each parsed by its match kind, field-filter-ops.js), its expansions,
 * and pagination (`limit` / `cursor`).
 *
 * The request has already been validated against the route's querystring
 * schema (query-schemas.js) by the time it arrives: unknown parameters, empty
 * or illegal filter values, non-boolean expansions, a bad `limit` and `ids`
 * combined with pagination are all 400s there. What is left here is what JSON
 * Schema cannot express: splitting `ids` and capping the distinct count,
 * parsing field-filter values (a reversed year range, an empty author name),
 * decoding the cursor, and the default `limit`. It runs before any query, so a
 * malformed request never reaches the repository. The `translate` stage
 * (filter to SQL predicate) lives in the repository.
 */

import { decodeCursor } from './cursor.js';
import { filterOp } from './field-filter-ops.js';

/** Max distinct ids accepted by a single multi-entity read. */
export const MAX_IDS = 100;

/** Page size for a list request that sends no `limit` (matches {@link MAX_IDS}). */
export const DEFAULT_LIMIT = 100;

/** Largest `limit` a client may ask for; above this is a 400, never a clamp. */
export const MAX_LIMIT = 1000;

/**
 * Turn a validated `request.query` into a normalized filter object.
 *
 * `ids`: absent → no `ids` key (caller lists all heads). Present → split on
 * commas, trimmed, de-duplicated (request order is not kept); more than
 * {@link MAX_IDS} distinct ids → 400. `permid`s are opaque, so an unknown id is
 * simply absent from the result (reported as `missing`), never rejected here.
 *
 * Field filters (`filterDefs`): each sent value is parsed by its match kind
 * into what its predicate binds, which may be a 400. Expansions
 * (`expansionDefs`) are copied for the parameters the request sent; their values
 * were checked by the schema.
 *
 * Pagination: `limit` absent → {@link DEFAULT_LIMIT}. `cursor` present but
 * undecodable → 400.
 *
 * @param {Record<string, unknown>} query  `request.query`, after validation
 * @param {import('fastify').FastifyInstance['httpErrors']} httpErrors
 *   `fastify.httpErrors` (from @fastify/sensible)
 * @param {Record<string, object>} [filterDefs]  the resource's declared field filters
 * @param {Record<string, { type: 'boolean' }>} [expansionDefs]  its declared expansions
 * @returns {{ ids?: string[], fields?: Record<string, unknown>,
 *   expansions?: Record<string, boolean>,
 *   page: { limit: number, cursor?: { permid: string, direction: 'next'|'prev' } } }}
 */
export function collectListFilters(query, httpErrors, filterDefs = {}, expansionDefs = {}) {
  const filters = {};

  if ('ids' in query) {
    const ids = [...new Set(query.ids.split(',').map((id) => id.trim()).filter(Boolean))];
    if (ids.length > MAX_IDS) {
      throw httpErrors.badRequest(`\`ids\` accepts at most ${MAX_IDS} ids`);
    }
    filters.ids = ids;
  }

  const fields = pick(query, filterDefs);
  if (fields) {
    filters.fields = Object.fromEntries(
      Object.entries(fields).map(([param, value]) => [param, filterOp(filterDefs[param].op).parse(value, param, httpErrors)]),
    );
  }

  const expansions = pick(query, expansionDefs);
  if (expansions) filters.expansions = expansions;

  filters.page = { limit: query.limit ?? DEFAULT_LIMIT };
  if ('cursor' in query) {
    const cursor = decodeCursor(query.cursor);
    if (!cursor) {
      throw httpErrors.badRequest('`cursor` is not a valid cursor; follow `links.next`/`links.prev`');
    }
    filters.page.cursor = cursor;
  }

  return filters;
}

/** The sent parameters among `defs`, or undefined when there are none. */
function pick(query, defs) {
  const picked = Object.fromEntries(Object.keys(defs).filter((p) => p in query).map((p) => [p, query[p]]));
  return Object.keys(picked).length > 0 ? picked : undefined;
}
