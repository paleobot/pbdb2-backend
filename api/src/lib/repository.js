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
 * Shape a DB row into the public resource: the `permid` plus the JSONB payload.
 * Internal serial ids and the version-chain columns are NEVER selected, so they
 * cannot leak.
 */
function toResource(row) {
  return { permid: row.permid, ...row.payload };
}

/**
 * @param {object} args
 * @param {{ query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> }} args.pg
 *   a @fastify/postgres client (or a compatible fake in tests)
 * @param {string} args.table        backing table name (from the descriptor)
 * @param {string} args.jsonbColumn  JSONB payload column (from the descriptor)
 */
export function makeReadRepository({ pg, table, jsonbColumn }) {
  const from = ident(table);
  const payload = ident(jsonbColumn);
  const select = `SELECT permid, ${payload} AS payload FROM ${from}`;

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
      return rows.length ? toResource(rows[0]) : null;
    },

    /**
     * Current heads of every non-removed lineage in the table.
     */
    async list() {
      const { rows } = await pg.query(`${select} WHERE ${HEAD_FILTER} ORDER BY permid`);
      return rows.map(toResource);
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
