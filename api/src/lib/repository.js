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
import { DEFAULT_LIMIT } from './list-filters.js';
import { BACKWARD } from './cursor.js';

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
 * Build the embedded `{ <label>, permid }` object for one link target, reading
 * the label from whichever source the target declares: a key inside a JSONB
 * payload column, or a plain column on the table. The emitted shape is
 * identical either way, so a citing resource cannot tell which kind of target
 * it linked to.
 *
 * A target declaring neither form throws here — a named error at projection
 * time, rather than SQL that fails against a column that does not exist.
 *
 * @param {import('./resource-tables.js').LinkTarget} target
 * @param {string} group  the target's route group name, for the error message
 */
function labelObject(target, group) {
  if (target.labelColumn) {
    // Plain-column label (a derived table with no payload): the column name is
    // also the emitted field name, mirroring how `label` doubles up below.
    const name = literal(target.labelColumn);
    return `json_build_object(${name}, r.${bareIdent(target.labelColumn)}, 'permid', r.permid)`;
  }

  if (target.payloadColumn && target.label) {
    const label = literal(target.label);
    return `json_build_object(${label}, r.${bareIdent(target.payloadColumn)}->>${label}, 'permid', r.permid)`;
  }

  throw new Error(
    `Link target '${group}' declares no label source: expected either ` +
      `\`payloadColumn\` + \`label\` (a JSONB key) or \`labelColumn\` (a plain column)`,
  );
}

/**
 * Build the SELECT-list expressions that resolve a resource's declared links
 * into embedded `{ <label>, permid }` objects, from the descriptor's `links`
 * config. The target route group supplies the table and the label source (see
 * LINK_TARGETS); the declaration supplies the FK column and whether it holds
 * the target's serial id or its `permid`. The persistence layer stays
 * HTTP-agnostic: `href` is NOT built here — it is hydrated at the route
 * boundary (see link-hydration.js).
 *
 * Soft-removed targets are suppressed in SQL (`NOT COALESCE(r.removed, false)`):
 * a removed single-valued target yields `NULL`, removed join-table rows drop out
 * of the aggregate — so the array count is always correct and no dangling link
 * can form. The label is read from the target's declared source (JSONB key or
 * plain column); `permid` is the lineage id. Because the backend swing trigger
 * keeps id-keyed FKs pointed at the current head, reading straight off the
 * target row yields the current label + stable permid.
 *
 * The suppression predicate is applied uniformly, including to targets whose
 * `removed` column is never written (`taxa`). There it is a harmless no-op —
 * the column exists, so no 42703, and it is always NULL — and keeping it
 * uniform means the shared machinery has one rule rather than a per-target
 * exemption. Taxa's OWN read applies no such predicate; see taxa-repository.js.
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
    const object = labelObject(target, link.target);
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
     * One page of current heads, narrowed by optional criteria that compose
     * into a single `WHERE` (the `translate` stage). Contributors:
     *   - `HEAD_FILTER` — always
     *   - `ids`    → `permid = ANY($n)`               (the multi-entity read)
     *   - `fields` → `payload->>'<jsonPath>' = $n`    (one per declared filter)
     *   - `page`   → `permid > $n` / `permid < $n`    (the keyset cursor)
     * Filter *values* are bound as parameters; only declared filters translate
     * (others are ignored). A bare call is the first page of every head.
     *
     * `ORDER BY permid` is the contract, not an incidental detail: the keyset
     * names a position in that total order, so it is what keeps pages from
     * skipping or repeating records when rows are inserted between requests.
     * A backward page walks DESC and is reversed before returning, so `records`
     * ascends by `permid` whichever way the client travelled.
     *
     * The query asks for `limit + 1` rows: the extra row is never returned as
     * data, it only answers "is there a further page?" without a second query.
     *
     * @param {{ ids?: string[], fields?: Record<string, string>,
     *   page?: { limit?: number, cursor?: { permid: string, direction: 'next'|'prev' } }
     * }} [criteria]
     * @returns {Promise<{ records: object[], hasMore: boolean }>}
     */
    async readHeads({ ids, fields, page } = {}) {
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

      const { limit = DEFAULT_LIMIT, cursor } = page ?? {};
      const backward = cursor?.direction === BACKWARD;

      if (cursor) {
        values.push(cursor.permid);
        predicates.push(`permid ${backward ? '<' : '>'} $${values.length}`);
      }

      values.push(limit + 1);
      const { rows } = await pg.query(
        `${select} WHERE ${predicates.join(' AND ')} ` +
          `ORDER BY permid ${backward ? 'DESC' : 'ASC'} LIMIT $${values.length}`,
        values,
      );

      const hasMore = rows.length > limit;
      const pageRows = hasMore ? rows.slice(0, limit) : rows;
      if (backward) pageRows.reverse();

      return { records: pageRows.map((row) => toResource(row, links)), hasMore };
    },

    /**
     * The first page of current heads, as a plain array — a named convenience
     * for callers that want heads without paging (it is still bounded by
     * `DEFAULT_LIMIT`; no read is unbounded).
     */
    async list() {
      const { records } = await this.readHeads();
      return records;
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

  // A descriptor with no payload column describes a table this engine cannot
  // read — no JSONB to select, and no version chain for HEAD_FILTER to filter.
  // Fail by name here rather than emitting SQL that dies with a 42703.
  if (!descriptor.jsonbColumn) {
    throw new Error(
      `Resource '${resource}' has no JSONB payload column and cannot use the generic ` +
        `repository; it needs a dedicated read module (see taxa-repository.js)`,
    );
  }

  return makeReadRepository({ pg: fastify.pg, ...descriptor });
}
