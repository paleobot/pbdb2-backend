/**
 * Generic read repository for the version-chained resource tables.
 *
 * The backend is append-only: each row carries a `permid` (stable across
 * versions), a JSONB payload, a version chain (`preceded_by_id` /
 * `succeeded_by_id`), and soft deletion (`removed`). A "read" is therefore
 * always "give me the current head of the lineage" — the row with no successor
 * that is not soft-removed. The version/lineage logic itself lives in the
 * database (plpgsql triggers), so the app side stays this thin.
 *
 * One engine serves every uniform resource, parameterized by table + JSONB
 * column from the descriptor map — mirroring the route factory in
 * crud-routes.js. `schemas` is the exception (see schema-tree.js).
 */

import { descriptorFor, targetFor } from './resource-tables.js';

const HEAD_FILTER = 'succeeded_by_id IS NULL AND NOT COALESCE(removed, false)';

/**
 * Quote a SQL identifier. Table/column names originate only from the trusted
 * descriptor map (never request input), but quoting keeps them safe and exact.
 *
 * @param {string} name
 */
function ident(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

/**
 * Quote a SQL string literal. Used for a JSONB key in a `->>'key'` path, where
 * the key is a string literal (not an identifier). The key originates only from
 * the trusted descriptor's filter config (never request input); escaping keeps
 * it exact and injection-proof regardless. Filter *values* are request input and
 * are always bound as parameters, never passed here.
 *
 * @param {string} value
 */
function literal(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * A name that was a SQL literal before link targets became data: the target's
 * table and payload column, and a join table's FK column. They are interpolated
 * unquoted so the generated SQL is unchanged from the hand-written form they
 * replace; since they now come from the descriptor/registry rather than the
 * template, the shape check is what keeps that safe. Names that were already
 * interpolated (`via` on the citing table, `joinTable`, `joinKey`, the output
 * field) keep their {@link ident} quoting.
 *
 * @param {string} name
 */
function bareIdent(name) {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new Error(`Unsafe SQL identifier in link config: ${name}`);
  }
  return name;
}

/**
 * Build the SELECT-list expressions that resolve a resource's declared links
 * into embedded `{ <label>, permid }` objects, from the descriptor's `links`
 * config. The target route group supplies the table, payload column and label
 * key (see LINK_TARGETS); the declaration supplies the FK column and whether it
 * holds the target's serial id or its `permid`. The persistence layer stays
 * HTTP-agnostic: `href` is NOT built here — it is hydrated at the route
 * boundary (see link-hydration.js).
 *
 * Soft-removed targets are suppressed in SQL (`NOT COALESCE(r.removed, false)`):
 * a removed single-valued target yields `NULL`, removed join-table rows drop out
 * of the aggregate — so the array count is always correct and no dangling link
 * can form. The label is read from the target's JSONB; `permid` is the lineage
 * id. Because the backend swing trigger keeps id-keyed FKs pointed at the
 * current head, reading straight off the target row yields the current label +
 * stable permid.
 *
 * @param {Record<string, import('./resource-tables.js').LinkDeclaration>} [links]
 * @param {string} qualifier  SQL qualifier for the citing row (a quoted table
 *   name for the generic select, or a CTE alias like `ts` for the schema tree)
 * @returns {string[]} aliased SELECT-list expressions (empty when no links)
 */
export function linkProjections(links, qualifier) {
  if (!links) return [];
  const exprs = [];

  for (const [as, link] of Object.entries(links)) {
    const target = targetFor(link.target);
    if (!target) throw new Error(`Unknown link target: ${link.target}`);

    const from = bareIdent(target.table);
    const label = literal(target.label);
    const object = `json_build_object(${label}, r.${bareIdent(target.payloadColumn)}->>${label}, 'permid', r.permid)`;
    // An id-keyed link matches the target's internal id; a permid-keyed one
    // matches its permid directly, needing no id→permid translation.
    const matchOn = link.on === 'permid' ? 'permid' : 'id';

    if (link.joinTable) {
      exprs.push(
        `(SELECT COALESCE(json_agg(${object}), '[]'::json) ` +
          `FROM ${ident(link.joinTable)} j JOIN ${from} r ON r.${matchOn} = j.${bareIdent(link.via)} ` +
          `WHERE j.${ident(link.joinKey)} = ${qualifier}.id ` +
          `AND NOT COALESCE(r.removed, false)) AS ${ident(as)}`,
      );
    } else {
      exprs.push(
        `(SELECT ${object} ` +
          `FROM ${from} r WHERE r.${matchOn} = ${qualifier}.${ident(link.via)} ` +
          `AND NOT COALESCE(r.removed, false)) AS ${ident(as)}`,
      );
    }
  }

  return exprs;
}

/**
 * Shape a DB row into the public resource: the `permid` plus the JSONB payload,
 * plus any resolved link projections (merged in under their output field name).
 * Only fields named by the `links` config are merged, and only when present on
 * the row — so a `null` single-valued link is kept (removed → null) while a
 * column absent from a test fake is skipped. Internal serial ids and
 * version-chain columns are NEVER selected, so they cannot leak.
 */
function toResource(row, links) {
  const result = { permid: row.permid, ...row.payload };
  if (links) {
    for (const as of Object.keys(links)) {
      if (as in row) result[as] = row[as];
    }
  }
  return result;
}

/**
 * @param {object} args
 * @param {{ query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> }} args.pg
 *   a @fastify/postgres client (or a compatible fake in tests)
 * @param {string} args.table        backing table name (from the descriptor)
 * @param {string} args.jsonbColumn  JSONB payload column (from the descriptor)
 */
export function makeReadRepository({ pg, table, jsonbColumn, links, filters = {} }) {
  const from = ident(table);
  const payload = ident(jsonbColumn);
  // Link sub-selects correlate to the citing row via the quoted table name
  // (the outer select is unaliased), keeping the head-select skeleton unchanged.
  const projections = linkProjections(links, from);
  const projectionCols = projections.length ? `, ${projections.join(', ')}` : '';
  const select = `SELECT permid, ${payload} AS payload${projectionCols} FROM ${from}`;

  return {
    // Declared field filters, exposed so the route seam knows which query params
    // this resource accepts and the head read can translate them to predicates.
    filters,

    /**
     * Current head for a `permid`, or null if there is no current, non-removed
     * version (missing lineage, superseded head, or soft-removed head).
     *
     * @param {string} permid
     */
    async readHead(permid) {
      const { rows } = await pg.query(
        `${select} WHERE permid = $1 AND ${HEAD_FILTER} LIMIT 1`,
        [permid],
      );
      return rows.length ? toResource(rows[0], links) : null;
    },

    /**
     * Current heads, narrowed by optional criteria that compose into a single
     * `WHERE` (the `translate` stage). Contributors:
     *   - `HEAD_FILTER` — always
     *   - `ids`    → `permid = ANY($n)`               (the multi-entity read)
     *   - `fields` → `payload->>'<jsonPath>' = $n`    (one per declared filter)
     * A bare call (no criteria) lists every current head. Filter *values* are
     * bound as parameters; only declared filters translate (others are ignored).
     * Order is by permid, not request order.
     *
     * @param {{ ids?: string[], fields?: Record<string, string> }} [criteria]
     */
    async readHeads({ ids, fields } = {}) {
      const predicates = [HEAD_FILTER];
      const values = [];

      if (ids) {
        values.push(ids);
        predicates.push(`permid = ANY($${values.length})`);
      }

      if (fields) {
        for (const [param, value] of Object.entries(fields)) {
          const def = filters[param];
          if (!def) continue; // defensive: only declared filters reach SQL
          values.push(value);
          predicates.push(`${payload}->>${literal(def.jsonPath)} = $${values.length}`);
        }
      }

      const { rows } = await pg.query(
        `${select} WHERE ${predicates.join(' AND ')} ORDER BY permid`,
        values,
      );
      return rows.map((row) => toResource(row, links));
    },

    /**
     * Current heads of every non-removed lineage — a bare {@link readHeads}.
     * Retained as a named convenience for the unfiltered list.
     */
    async list() {
      return this.readHeads();
    },
  };
}

/**
 * Build a read repository for a named resource from a Fastify instance, or
 * return undefined when reads should fall back to stubs — i.e. the resource has
 * no backing table (`specimens`) or no PostgreSQL connection is present (no
 * `PG_*` configured; no fake injected in tests).
 *
 * @param {import('fastify').FastifyInstance} fastify
 * @param {string} resource  route group name (e.g. 'references')
 */
export function repositoryForResource(fastify, resource) {
  const descriptor = descriptorFor(resource);
  if (!descriptor || !fastify.hasDecorator('pg')) return undefined;
  return makeReadRepository({ pg: fastify.pg, ...descriptor });
}
