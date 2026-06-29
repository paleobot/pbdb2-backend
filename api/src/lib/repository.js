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

import { descriptorFor } from './resource-tables.js';

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
 * Build the SELECT-list expressions that resolve a resource's references into
 * embedded `{ title, permid }` objects, from the descriptor's `references`
 * config. The persistence layer stays HTTP-agnostic: `href` is NOT built here —
 * it is hydrated at the route boundary (see reference-hydration.js).
 *
 * Soft-removed references are suppressed in SQL (`NOT COALESCE(r.removed,
 * false)`): a removed primary yields `NULL`, removed additional rows drop out of
 * the aggregate — so the array count is always correct and no dangling link can
 * form. `title` is read from the refs JSONB; `permid` is the lineage id. Because
 * the backend swing trigger keeps the FK pointed at the current head, reading
 * straight off the referenced row yields the current title + stable permid.
 *
 * @param {import('./resource-tables.js').ReferenceConfig} [references]
 * @param {string} qualifier  SQL qualifier for the citing row (a quoted table
 *   name for the generic select, or a CTE alias like `ts` for the schema tree)
 * @returns {string[]} aliased SELECT-list expressions (empty when no references)
 */
export function referenceProjections(references, qualifier) {
  if (!references) return [];
  const exprs = [];

  if (references.primary) {
    const { as, via } = references.primary;
    exprs.push(
      `(SELECT json_build_object('title', r.reference->>'title', 'permid', r.permid) ` +
        `FROM refs r WHERE r.id = ${qualifier}.${ident(via)} ` +
        `AND NOT COALESCE(r.removed, false)) AS ${ident(as)}`,
    );
  }

  if (references.additional) {
    const { as, joinTable, joinKey } = references.additional;
    exprs.push(
      `(SELECT COALESCE(json_agg(json_build_object('title', r.reference->>'title', 'permid', r.permid)), '[]'::json) ` +
        `FROM ${ident(joinTable)} j JOIN refs r ON r.id = j.reference_id ` +
        `WHERE j.${ident(joinKey)} = ${qualifier}.id ` +
        `AND NOT COALESCE(r.removed, false)) AS ${ident(as)}`,
    );
  }

  return exprs;
}

/**
 * Shape a DB row into the public resource: the `permid` plus the JSONB payload,
 * plus any resolved reference projections (merged in by their `as` key). Only
 * keys named by the `references` config are merged, and only when present on the
 * row — so a `null` primary is kept (removed → null) while a column absent from
 * a test fake is skipped. Internal serial ids and version-chain columns are
 * NEVER selected, so they cannot leak.
 */
function toResource(row, references) {
  const result = { permid: row.permid, ...row.payload };
  if (references) {
    for (const cfg of Object.values(references)) {
      if (cfg.as in row) result[cfg.as] = row[cfg.as];
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
export function makeReadRepository({ pg, table, jsonbColumn, references }) {
  const from = ident(table);
  const payload = ident(jsonbColumn);
  // Reference sub-selects correlate to the citing row via the quoted table name
  // (the outer select is unaliased), keeping the head-select skeleton unchanged.
  const projections = referenceProjections(references, from);
  const projectionCols = projections.length ? `, ${projections.join(', ')}` : '';
  const select = `SELECT permid, ${payload} AS payload${projectionCols} FROM ${from}`;

  return {
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
      return rows.length ? toResource(rows[0], references) : null;
    },

    /**
     * Current heads of every non-removed lineage in the table.
     */
    async list() {
      const { rows } = await pg.query(`${select} WHERE ${HEAD_FILTER} ORDER BY permid`);
      return rows.map((row) => toResource(row, references));
    },

    /**
     * Current heads for a set of permids — the multi-entity read. Same head
     * skeleton as `list()`, narrowed to the requested set via `permid = ANY($1)`.
     * Returns only the permids that have a current, non-removed head; misses are
     * simply absent (no error) — partial-success accounting is computed at the
     * route boundary. Order is by permid, not request order.
     *
     * @param {string[]} permids
     */
    async readHeads(permids) {
      const { rows } = await pg.query(
        `${select} WHERE permid = ANY($1) AND ${HEAD_FILTER} ORDER BY permid`,
        [permids],
      );
      return rows.map((row) => toResource(row, references));
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
