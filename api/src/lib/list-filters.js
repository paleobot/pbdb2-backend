/**
 * The list-endpoint query-filter seam. Every list filter is parsed and
 * validated here, then handed to the route handler as a normalized object —
 * so a new filter is a contributor to this function, not a fresh branch bolted
 * onto the handler. Today its only contributor is `ids` (the multi-entity read).
 *
 * Only request-derived validation lives here (the cheap checks that need no
 * database). It runs before any query, so a malformed request never reaches the
 * repository.
 */

/** Max distinct ids accepted by a single multi-entity read. */
export const MAX_IDS = 100;

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
 * @param {Record<string, unknown>} query  `request.query`
 * @param {import('fastify').FastifyInstance['httpErrors']} httpErrors
 *   `fastify.httpErrors` (from @fastify/sensible)
 * @returns {{ ids?: string[] }}
 */
export function collectListFilters(query, httpErrors) {
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

  return filters;
}
