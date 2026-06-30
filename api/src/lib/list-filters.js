/**
 * The list-endpoint query-filter seam. Every list filter is parsed and
 * validated here, then handed to the route handler as a normalized object —
 * so a new filter is a contributor to this function, not a fresh branch bolted
 * onto the handler. Today its only contributor is `ids` (the multi-entity read).
 *
 * This is the `validate` stage of the filter pipeline. Only request-derived
 * checks live here (the cheap ones that need no database). It runs before any
 * query, so a malformed request never reaches the repository. The `define`
 * stage is the resource's declared filters (passed as `filterDefs`); the
 * `translate` stage — turning a filter into a SQL predicate — lives in the
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
 * Field filters (per-entity, from `filterDefs`):
 * - a declared param present with a value → narrows by that JSONB field
 * - present with an empty value → 400 (mirrors the `ids` rule)
 * - values are opaque strings — NO enum validation (provisional; an
 *   enum-bearing JSON Schema will later be able to reject out-of-enum values)
 * - unrecognized params are ignored (lenient; also provisional)
 *
 * @param {Record<string, unknown>} query  `request.query`
 * @param {import('fastify').FastifyInstance['httpErrors']} httpErrors
 *   `fastify.httpErrors` (from @fastify/sensible)
 * @param {Record<string, { jsonPath: string, op: string }>} [filterDefs]
 *   the resource's declared field filters (its `define` stage)
 * @returns {{ ids?: string[], fields?: Record<string, string> }}
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

  return filters;
}
