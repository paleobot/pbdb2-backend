/**
 * Read repository for `taxa` — the API's first read-only, non-JSONB resource.
 *
 * WHY THIS IS NOT THE GENERIC REPOSITORY. `repository.js` serves version-chained
 * JSONB resources: it selects `<jsonbColumn> AS payload` and filters
 * `succeeded_by_id IS NULL AND NOT COALESCE(removed, false)`. `taxa` has neither
 * a payload column nor a version chain (`succeeded_by_id` does not exist on it,
 * which is a SQL 42703 on every request, not a degradation). Teaching the
 * generic engine both shapes would mean a conditional in each of its query
 * builders to serve one resource, so `taxa` gets its own module — the same
 * precedent `schema-tree.js` set, though for a different reason (that one's READ
 * is an aggregate; this one's TABLE is a different shape).
 *
 * What is NOT forked: link resolution. `linkProjections()` is imported from the
 * generic repository and correlated to this module's `t` alias, exactly as the
 * schema tree correlates it to its CTE alias. Link SQL has one implementation.
 *
 * NO `removed` PREDICATE. `taxa.removed` exists but is dead: `rebuild_taxa()`
 * names it in neither its INSERT column list nor its `ON CONFLICT DO UPDATE SET`,
 * and rows its derivation stops producing are HARD-deleted. Verified live: zero
 * rows carry a non-null `removed`. Soft deletion is honored one layer upstream —
 * `derive_taxa()` reads the opinion tables through
 * `WHERE n.removed IS NOT TRUE AND n.succeeded_by_id IS NULL` — so by the time a
 * row exists here it has already passed that filter. Applying a predicate on a
 * column no writer sets would encode a false belief that removal is soft here.
 * See the change's design.md.
 *
 * The exposed methods are named `readHead` / `readHeads` to duck-type the
 * generic repository, so `crud-routes.js` and `listReadHandler` drive this
 * resource with no special-casing — even though "head" is a misnomer for a table
 * with one row per permid and no lineage.
 */

import { linkProjections } from './repository.js';
import { descriptorFor } from './resource-tables.js';
import { ancestorPermids } from './classification-path.js';
import { DEFAULT_LIMIT } from './list-filters.js';
import { BACKWARD } from './cursor.js';

/** Outer-row alias. Link sub-selects use `r`, so the two never collide. */
const SELF = 't';

/**
 * Dictionary joins. These tables live in the `dictionaries` PostgreSQL schema,
 * so their names are schema-qualified and cannot pass through `bareIdent()` in
 * repository.js (which rejects the dot). They are constants in this template
 * rather than descriptor data, so no request input reaches them.
 *
 * Both are LEFT joins. `rank_id` is `NOT NULL` with a foreign key, so an inner
 * join would be equivalent — but a LEFT join means a taxon can never vanish from
 * a read because a dictionary row is missing, which is the safer failure.
 */
const DICTIONARY_JOINS =
  ' LEFT JOIN dictionaries.taxonomy_ranks tr ON tr.id = t.rank_id' +
  ' LEFT JOIN dictionaries.nomenclatural_statuses ns ON ns.id = t.nomenclatural_status_id';

/**
 * Columns every taxa read projects. `classification_path` is selected as text
 * for the chain and stripped before the record is returned — it is machinery,
 * not part of the representation. Internal serial ids and the
 * `winning_*_opinion_id` provenance columns are never selected.
 */
const BASE_COLUMNS =
  't.permid, t.name, tr.taxonomy_rank AS rank, ns.status AS "nomenclaturalStatus"';

/** The chain needs only enough of an ancestor to render a breadcrumb. */
const ANCESTOR_COLUMNS = 't.concept_permid, t.permid, t.name, tr.taxonomy_rank AS rank';

/**
 * Shape a DB row into the public taxon: the projected columns plus any resolved
 * links, with the path removed. `containingTaxa` is attached separately, because
 * it is resolved for a whole page at once rather than per row.
 */
function toTaxon(row, links) {
  const { classification_path: _path, ...rest } = row;
  const taxon = { ...rest };
  if (links) {
    for (const as of Object.keys(links)) {
      if (as in row) taxon[as] = row[as];
    }
  }
  return taxon;
}

/**
 * Nest a taxon's ancestors into the recursive `containingTaxa` shape, given
 * ancestors ordered ROOT-FIRST and a map of concept permid → breadcrumb.
 *
 * The outermost object is the taxon's IMMEDIATE container, and each nests the
 * next one root-ward, with the root's own `containingTaxa` null. A taxon with no
 * ancestors (a root) yields null.
 *
 * An ancestor absent from the map is skipped rather than rendered as a hole.
 * That cannot happen against current data — every concept has exactly one row
 * where `permid = concept_permid`, verified across all rows — but a partial
 * chain is a better failure than a malformed one.
 *
 * @param {string[]} ancestors  concept permids, root-first
 * @param {Map<string, object>} breadcrumbs  concept permid → { rank, name, permid }
 */
function nestChain(ancestors, breadcrumbs) {
  let node = null;
  for (const conceptPermid of ancestors) {
    const crumb = breadcrumbs.get(conceptPermid);
    if (!crumb) continue;
    node = { ...crumb, containingTaxa: node };
  }
  return node;
}

/**
 * @param {object} args
 * @param {{ query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> }} args.pg
 *   a @fastify/postgres client (or a compatible fake in tests)
 */
export function makeTaxaRepository({ pg }) {
  const links = descriptorFor('taxa').links;
  const projections = linkProjections(links, SELF);
  const projectionCols = projections.length ? `, ${projections.join(', ')}` : '';

  const select =
    `SELECT ${BASE_COLUMNS}, t.classification_path::text AS classification_path${projectionCols}` +
    ` FROM taxa ${SELF}${DICTIONARY_JOINS}`;

  /**
   * Resolve the breadcrumbs for a set of ancestor concept permids in ONE query.
   *
   * The `permid = concept_permid` predicate is load-bearing, not decorative: a
   * concept can be shared by many rows (up to 88 measured — synonyms and
   * alternate spellings all carry the same `concept_permid`), so matching on
   * `concept_permid` alone would fan a single chain level out into every synonym
   * of it. Exactly one row per concept satisfies `permid = concept_permid`,
   * verified across all 517,226 rows.
   *
   * @param {string[]} conceptPermids
   * @returns {Promise<Map<string, object>>} concept permid → breadcrumb
   */
  async function fetchBreadcrumbs(conceptPermids) {
    const breadcrumbs = new Map();
    if (conceptPermids.length === 0) return breadcrumbs;

    const { rows } = await pg.query(
      `SELECT ${ANCESTOR_COLUMNS} FROM taxa ${SELF}${DICTIONARY_JOINS}` +
        ` WHERE t.concept_permid = ANY($1) AND t.permid = t.concept_permid`,
      [conceptPermids],
    );

    for (const row of rows) {
      const { concept_permid: conceptPermid, ...crumb } = row;
      breadcrumbs.set(conceptPermid, crumb);
    }
    return breadcrumbs;
  }

  /**
   * Attach `containingTaxa` to every record in one pass, pooling the ancestor
   * fetch across the whole set.
   *
   * Pooling is the point: for a 100-item page of deep taxa, 3,930 ancestor
   * entries resolve to 310 distinct ancestors — a 12.7× duplication factor
   * (measured, `docs/taxa-classification-reads.md` §6). One `= ANY()` fetch
   * serves them all, and the shared breadcrumb objects are re-nested per record.
   */
  async function attachChains(records, paths) {
    const perRecord = paths.map(ancestorPermids);
    const distinct = [...new Set(perRecord.flat())];
    const breadcrumbs = await fetchBreadcrumbs(distinct);

    records.forEach((record, i) => {
      record.containingTaxa = nestChain(perRecord[i], breadcrumbs);
    });
    return records;
  }

  return {
    /**
     * `taxa` declares no field filters in this change. The property is present
     * so the shared list seam can read it uniformly.
     */
    filters: {},

    /**
     * One taxon by `permid`, or null when no row bears it. No version
     * resolution and no soft-removal predicate (see the module comment).
     *
     * The chain is ALWAYS attached: a single read has exactly one object, so the
     * depth that makes chains expensive on a list costs one extra query here.
     */
    async readHead(permid) {
      const { rows } = await pg.query(`${select} WHERE t.permid = $1 LIMIT 1`, [permid]);
      if (rows.length === 0) return null;

      const [taxon] = await attachChains(
        [toTaxon(rows[0], links)],
        [rows[0].classification_path],
      );
      return taxon;
    },

    /**
     * One page of taxa, ordered by `permid` — the same keyset contract every
     * other list read follows, so `pageLinks` and the shared list handler work
     * unchanged. Ordering by `permid` on a derived table is arbitrary (it is
     * UUIDv7, i.e. rebuild insertion order); a name-ordered compound cursor is
     * the recorded follow-up, kept open by the cursor token being opaque.
     *
     * `fields` is accepted and ignored: taxa declares no filters, and the seam
     * rejects undeclared parameters before they reach here.
     *
     * @param {{ ids?: string[], fields?: object,
     *   page?: { limit?: number, cursor?: { permid: string, direction: 'next'|'prev' } },
     *   expansions?: { includeContainingTaxa?: boolean } }} [criteria]
     */
    async readHeads({ ids, page, expansions } = {}) {
      const predicates = [];
      const values = [];

      if (ids) {
        values.push(ids);
        predicates.push(`t.permid = ANY($${values.length})`);
      }

      const { limit = DEFAULT_LIMIT, cursor } = page ?? {};
      const backward = cursor?.direction === BACKWARD;

      if (cursor) {
        values.push(cursor.permid);
        predicates.push(`t.permid ${backward ? '<' : '>'} $${values.length}`);
      }

      values.push(limit + 1);
      const where = predicates.length ? ` WHERE ${predicates.join(' AND ')}` : '';
      const { rows } = await pg.query(
        `${select}${where} ORDER BY t.permid ${backward ? 'DESC' : 'ASC'}` +
          ` LIMIT $${values.length}`,
        values,
      );

      const hasMore = rows.length > limit;
      const pageRows = hasMore ? rows.slice(0, limit) : rows;
      if (backward) pageRows.reverse();

      const records = pageRows.map((row) => toTaxon(row, links));

      // The chain is omitted from list items unless asked for: it is ~457 kB of
      // mostly-duplicate text per 100-item page (measured, §6).
      if (expansions?.includeContainingTaxa) {
        await attachChains(
          records,
          pageRows.map((row) => row.classification_path),
        );
      }

      return { records, hasMore };
    },
  };
}

/**
 * Build the taxa repository from a Fastify instance, or undefined when no
 * PostgreSQL connection is present. Unlike the uniform resources there is no
 * stub fallback — `taxa` is half a million derived rows, and a stub taxonomy
 * would be a fiction no test or client could use.
 *
 * @param {import('fastify').FastifyInstance} fastify
 */
export function taxaRepository(fastify) {
  if (!fastify.hasDecorator('pg')) return undefined;
  return makeTaxaRepository({ pg: fastify.pg });
}
