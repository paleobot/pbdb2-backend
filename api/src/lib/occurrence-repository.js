/**
 * Read repository for `occurrences` and, nested under each, its identifications
 * (occurrence-reads; openspec/changes/add-occurrence-reads/design.md, D2–D8).
 *
 * `occurrences` is, like `taxa`, a derived cache of typed columns
 * (rebuild_occurrences()) with no version chain and no write path, so it gets its
 * own module rather than a branch in the generic repository. The two share only
 * the `permid_no` keyset loop; a shared "derived-table repository" waits for a
 * third caller (D2).
 *
 * One SQL statement reads a page. The occurrence row (`o`) is joined one-to-one
 * with its winning identification (`w`), the identified taxon (`it`, LEFT: a
 * taxon permid need not have a `taxa` row) and the current abundance (`a`, LEFT).
 * Links resolve through `linkProjections()` correlated to whichever of those rows
 * carries the foreign key: the descriptor's `row` names it (D3). The swing trigger
 * keeps every id-keyed FK on the current head, so plain joins resolve heads.
 *
 * NO `removed` PREDICATE on the cache: nothing writes `occurrences.removed`, and
 * an occurrence whose root is removed has no row (derive_occurrences()).
 *
 * The identified taxon is not a descriptor link. Its permid is the cache's own
 * column and must survive having no `taxa` row: such a taxon is `{ permid }`,
 * with no name and (at hydration) no href, and the occurrence's `acceptedTaxon`
 * is null (D4).
 *
 * The nested identifications are version-chained JSONB, so they read like every
 * such resource: through their payload source with `merge()`, one codec-context
 * load per page restricted to the page's keys (D6).
 *
 * `readHead` / `readHeads` duck-type the generic repository, so `crud-routes.js`,
 * `listReadHandler` and the CSV export drive occurrences unchanged.
 */

import { linkProjections } from './repository.js';
import { descriptorFor } from './resource-tables.js';
import { identifiedName } from './identified-name.js';
import { DEFAULT_LIMIT } from './list-filters.js';
import { BACKWARD, permidNumber } from './cursor.js';
import { identificationSource } from '../../../payloadSchemas/identification.schema.js';
import {
  merge, collectCodecSources, loadCodecContext, codecKeyColumns, storageSelects,
} from '../../../payloadSchemas/lib/storage.js';

/** SQL alias of each joined row a descriptor link can name (`row`); the occurrence's own is `o`. */
const ROW_ALIASES = { winner: 'w', identifiedTaxon: 'it' };

const RANKS = ['genus', 'subgenus', 'species', 'subspecies'];

/** The full identification record's field order: `name` after `permid`, then the source's. */
const FULL_RECORD_ORDER = ['permid', 'name', ...Object.keys(identificationSource.properties).filter((k) => k !== 'permid')];

/**
 * The rows joined to each occurrence. They join the PAGE, not the table: the
 * page is chosen from `occurrences` alone (filtered, ordered, limited) in a
 * subquery aliased `o`, so a filter matching 94,000 occurrences joins 101 of
 * them, whatever plan the planner picks for the filter.
 */
const JOINS =
  ' JOIN identifications w ON w.id = o.winning_identification_id' +
  ' LEFT JOIN taxa it ON it.permid = o.taxon_permid' +
  ' LEFT JOIN occurrence_abundances a' +
  ' ON a.occurrence_permid = o.permid AND a.succeeded_by_id IS NULL AND a.removed IS NOT TRUE';

/**
 * Every `taxa` permid in the subtree of a permid's accepted concept: the concept,
 * each concept contained in it at any depth, and every name of each (D8). The
 * walk follows concept rows only (`permid = concept_permid`), since every name of
 * a concept carries the same containing concept; then every row of the concepts
 * found is taken. A permid with no `taxa` row gives no rows.
 */
const SUBTREE_SQL =
  'WITH RECURSIVE sub(concept) AS (' +
  ' SELECT concept_permid FROM taxa WHERE permid = $1' +
  ' UNION' +
  ' SELECT c.permid FROM taxa c JOIN sub ON c.containing_concept_permid = sub.concept' +
  ' WHERE c.permid = c.concept_permid)' +
  ' SELECT t.permid FROM taxa t JOIN sub ON t.concept_permid = sub.concept';

/** The head collection row a `COL` permid names. */
const COLLECTION_ID_SQL = '(SELECT id FROM collections WHERE permid = $n AND succeeded_by_id IS NULL)';

/** A rank object with its keys in schema order (`resolution`, `name`); JSONB sorts them otherwise. */
function rankObject({ resolution, name }) {
  return {
    ...(resolution !== undefined ? { resolution } : {}),
    ...(name !== undefined ? { name } : {}),
  };
}

/** The identified taxon: `{ permid, name }`, `{ permid }` with no `taxa` row, or null with no permid. */
function taxonLink(permid, name) {
  if (permid == null) return null;
  return name == null ? { permid } : { permid, name };
}

/** One cache row as the public occurrence (field order: occurrenceSource). */
function toOccurrence(row) {
  const ranks = row.ranks ?? {};
  const identification = { permid: row.winner_permid, name: identifiedName(ranks) };
  for (const rank of RANKS) if (ranks[rank]) identification[rank] = rankObject(ranks[rank]);
  identification.taxon = taxonLink(row.taxon_permid, row.taxon_name);
  identification.reference = row['identification.reference'];

  const occurrence = {
    permid: row.permid,
    collection: row.collection,
    reference: row.reference,
    identification,
    acceptedTaxon: row.acceptedTaxon,
  };
  if (row.plant_organs != null) occurrence.plantOrgans = row.plant_organs;
  occurrence.abundance = row.abundance
    ? {
        ...(row.abundance.value !== undefined ? { value: row.abundance.value } : {}),
        ...(row.abundance.unit !== undefined ? { unit: row.abundance.unit } : {}),
      }
    : null;
  if (row.oldpbdb_occurrence_no != null) occurrence.legacyIDs = { oldpbdbID: String(row.oldpbdb_occurrence_no) };
  return occurrence;
}

/**
 * Keyset paging shared by the occurrence and identification lists: the cursor
 * predicate on `<alias>.permid_no`, `limit + 1` rows, a backward page reversed.
 */
function pageQuery(values, predicates, alias, page) {
  const { limit = DEFAULT_LIMIT, cursor } = page ?? {};
  const backward = cursor?.direction === BACKWARD;
  if (cursor) {
    values.push(permidNumber(cursor.permid));
    predicates.push(`${alias}.permid_no ${backward ? '<' : '>'} $${values.length}`);
  }
  values.push(limit + 1);
  const where = predicates.length ? ` WHERE ${predicates.join(' AND ')}` : '';
  const order = ` ORDER BY ${alias}.permid_no ${backward ? 'DESC' : 'ASC'}`;
  const tail = `${where}${order} LIMIT $${values.length}`;
  const finish = (rows) => {
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    if (backward) pageRows.reverse();
    return { pageRows, hasMore };
  };
  return { tail, order, finish };
}

/**
 * @param {object} args
 * @param {{ query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> }} args.pg
 *   a @fastify/postgres client (or a compatible fake in tests)
 */
export function makeOccurrenceRepository({ pg }) {
  const { links } = descriptorFor('occurrences');
  const byRow = new Map();
  for (const [as, link] of Object.entries(links)) {
    const alias = link.row === undefined ? 'o' : ROW_ALIASES[link.row];
    if (!alias) throw new Error(`occurrences link '${as}' names an unknown row '${link.row}'`);
    byRow.set(alias, { ...byRow.get(alias), [as]: link });
  }
  const projections = [...byRow].flatMap(([alias, group]) => linkProjections(group, alias));

  const columns =
    'SELECT o.permid, o.identification AS ranks, o.plant_organs, o.oldpbdb_occurrence_no, o.taxon_permid,' +
    ' w.permid AS winner_permid, it.name AS taxon_name, a.abundance' +
    projections.map((p) => `, ${p}`).join('');
  /** The statement reading the occurrences `pick` selects from the bare table, in `order`. */
  const statement = (pick, order = '') => `${columns} FROM (SELECT * FROM occurrences o${pick}) o${JOINS}${order}`;

  // The subtree's names, resolved once per request: a streamed export calls
  // readHeads once per batch with the same `fields` object, and re-walking a
  // 30,000-name subtree per batch would cost ~0.2 s each (design, Risks).
  const subtrees = new WeakMap();
  async function subtreeOf(fields) {
    if (!subtrees.has(fields)) {
      const { rows } = await pg.query(SUBTREE_SQL, [fields.withinTaxon]);
      subtrees.set(fields, rows.map((r) => r.permid));
    }
    return subtrees.get(fields);
  }

  // ---- identifications ----

  const identificationSelect =
    'SELECT i.identification AS payload' +
    storageSelects(identificationSource).map(({ column, expression }) => `, i.${expression}`).join('') +
    ' FROM identifications i';
  const IDENTIFICATION_HEAD = 'i.succeeded_by_id IS NULL AND i.removed IS NOT TRUE';
  const codecSources = collectCodecSources(identificationSource);
  const keyColumns = codecKeyColumns(identificationSource);

  /** Merge a page of identification heads through their source, with one codec-context load. */
  async function toIdentifications(rows) {
    if (rows.length === 0) return [];
    const selection = {};
    for (const source of codecSources) {
      const values = new Set();
      for (const column of keyColumns.get(source.table) ?? []) {
        for (const row of rows) if (row[column] != null) values.add(String(row[column]));
      }
      selection[source.table] = { column: source.key, values: [...values] };
    }
    const ctx = await loadCodecContext(pg, codecSources, selection);
    return rows.map((row) => {
      const merged = merge(identificationSource, { jsonb: row.payload, columns: row }, ctx);
      // `name` is composed here; an identification whose name did not resolve
      // has `taxon` null rather than absent.
      const full = { ...merged, name: identifiedName(merged.identification), taxon: merged.taxon ?? null };
      const record = {};
      for (const key of FULL_RECORD_ORDER) if (full[key] !== undefined) record[key] = full[key];
      return record;
    });
  }

  async function occurrenceExists(permid) {
    const { rows } = await pg.query('SELECT 1 FROM occurrences WHERE permid = $1', [permid]);
    return rows.length > 0;
  }

  return {
    /** One occurrence by `permid`, or null when the cache has no row for it. */
    async readHead(permid) {
      const { rows } = await pg.query(statement(' WHERE o.permid = $1'), [permid]);
      return rows.length ? toOccurrence(rows[0]) : null;
    },

    /**
     * One page of occurrences in `permid_no` order, narrowed by `ids` and the link
     * filters (AND). A `withinTaxon` whose subtree is empty matches nothing, and
     * is answered without reading the cache.
     *
     * @param {{ ids?: string[], fields?: { collection?: string, taxon?: string, withinTaxon?: string },
     *   page?: { limit?: number, cursor?: { permid: string, direction: 'next'|'prev' } } }} [criteria]
     */
    async readHeads({ ids, fields, page } = {}) {
      const values = [];
      const predicates = [];
      const bind = (value) => {
        values.push(value);
        return `$${values.length}`;
      };

      if (ids) predicates.push(`o.permid = ANY(${bind(ids)})`);
      if (fields?.collection !== undefined) {
        predicates.push(`o.collection_id = ${COLLECTION_ID_SQL.replace('$n', bind(fields.collection))}`);
      }
      if (fields?.taxon !== undefined) predicates.push(`o.taxon_permid = ${bind(fields.taxon)}`);
      if (fields?.withinTaxon !== undefined) {
        const names = await subtreeOf(fields);
        if (names.length === 0) return { records: [], hasMore: false };
        // The names are bound, then hidden from the planner behind an InitPlan.
        // Seeing a few dozen concrete values, it overestimates the matches and
        // walks the permid_no index filtering out most of the table (Tyrannosaurus,
        // 167 occurrences: 270 ms); behind the InitPlan it takes the taxon_permid
        // index and sorts (2 ms). Measured in design.md, "Verification".
        predicates.push(`o.taxon_permid = ANY(ARRAY(SELECT unnest(${bind(names)}::text[])))`);
      }

      const { tail, order, finish } = pageQuery(values, predicates, 'o', page);
      const { rows } = await pg.query(statement(tail, order), values);
      const { pageRows, hasMore } = finish(rows);
      return { records: pageRows.map(toOccurrence), hasMore };
    },

    /**
     * One page of an occurrence's current, non-removed identifications, the root
     * first (permid_no order), or null when the occurrence has no row.
     *
     * @param {string} occurrencePermid
     * @param {{ ids?: string[], page?: object }} [criteria]
     */
    async readIdentifications(occurrencePermid, { ids, page } = {}) {
      if (!(await occurrenceExists(occurrencePermid))) return null;
      const values = [occurrencePermid];
      const predicates = ['i.occurrence_permid = $1', IDENTIFICATION_HEAD];
      if (ids) {
        values.push(ids);
        predicates.push(`i.permid = ANY($${values.length})`);
      }
      const { tail, finish } = pageQuery(values, predicates, 'i', page);
      const { rows } = await pg.query(`${identificationSelect}${tail}`, values);
      const { pageRows, hasMore } = finish(rows);
      return { records: await toIdentifications(pageRows), hasMore };
    },

    /**
     * One identification's full record, or null when the occurrence has no row,
     * or the identification is missing, removed or belongs to another occurrence.
     *
     * @param {string} occurrencePermid
     * @param {string} permid
     */
    async readIdentification(occurrencePermid, permid) {
      if (!(await occurrenceExists(occurrencePermid))) return null;
      const { rows } = await pg.query(
        `${identificationSelect} WHERE i.permid = $1 AND i.occurrence_permid = $2 AND ${IDENTIFICATION_HEAD} LIMIT 1`,
        [permid, occurrencePermid],
      );
      if (rows.length === 0) return null;
      const [record] = await toIdentifications(rows);
      return record;
    },
  };
}


/**
 * Build the occurrence repository from a Fastify instance, or undefined when no
 * PostgreSQL connection is present. There is no stub: a stub list of two million
 * fossils would be a fiction, so the routes answer 503 instead.
 *
 * @param {import('fastify').FastifyInstance} fastify
 */
export function occurrenceRepository(fastify) {
  if (!fastify.hasDecorator('pg')) return undefined;
  return makeOccurrenceRepository({ pg: fastify.pg });
}
