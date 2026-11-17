/**
 * The characters and states under a schema, nested: the part of the `schemas`
 * single read that the generic repository does not produce. The route takes the
 * schema head from the repository (merged through `schemaSource`, as a list item
 * is) and adds this tree to it. Adapted from pbdb2-migrations/play/server.js.
 *
 * One recursive query reads every current, non-removed character and state
 * under the schema's current head (`succeeded_by_id IS NULL AND NOT
 * COALESCE(removed, false)` at every level), and selects no reference or link
 * columns. Each node is then merged through its payload source:
 * `characterSource` with its `permid` column, `stateSource` with `permid` and
 * `quantitative`. The sources decide which columns reach a node, so the tree
 * holds no storage layout of its own. Neither source declares a codec (a test
 * asserts it), so the nodes merge with no codec context.
 *
 * Internal serial ids, parent columns and `sort_order` are used only to nest
 * and order the nodes, and never reach a node. Nodes are keyed by `permid`
 * (the legacy exposed `pbotID`).
 */

import { merge } from '../../../payloadSchemas/lib/storage.js';
import { characterSource } from '../../../payloadSchemas/character.schema.js';
import { stateSource } from '../../../payloadSchemas/state.schema.js';

const SCHEMA_CHARACTERS_QUERY = `
WITH RECURSIVE
target_schema AS (
  SELECT s.id
  FROM schemas s
  WHERE s.permid = $1
    AND s.succeeded_by_id IS NULL
    AND NOT COALESCE(s.removed, false)
),
char_tree AS (
  SELECT c.id, c.permid, c.character AS payload,
         c.parent_schema_id, c.parent_character_id, c.sort_order, 0 AS depth
  FROM characters c
  JOIN target_schema ts ON c.parent_schema_id = ts.id
  WHERE c.succeeded_by_id IS NULL AND NOT COALESCE(c.removed, false)

  UNION ALL

  SELECT c.id, c.permid, c.character AS payload,
         c.parent_schema_id, c.parent_character_id, c.sort_order, ct.depth + 1
  FROM characters c
  JOIN char_tree ct ON c.parent_character_id = ct.id
  WHERE c.succeeded_by_id IS NULL AND NOT COALESCE(c.removed, false)
),
state_tree AS (
  SELECT s.id, s.permid, s.state AS payload, s.quantitative,
         s.parent_character_id, s.parent_state_id, s.sort_order, 0 AS depth
  FROM states s
  JOIN char_tree ct ON s.parent_character_id = ct.id
  WHERE s.succeeded_by_id IS NULL AND NOT COALESCE(s.removed, false)

  UNION ALL

  SELECT s.id, s.permid, s.state AS payload, s.quantitative,
         s.parent_character_id, s.parent_state_id, s.sort_order, st.depth + 1
  FROM states s
  JOIN state_tree st ON s.parent_state_id = st.id
  WHERE s.succeeded_by_id IS NULL AND NOT COALESCE(s.removed, false)
)
SELECT
  (
    SELECT COALESCE(json_agg(json_build_object(
      'id',                ct.id,
      'permid',            ct.permid,
      'payload',           ct.payload,
      'sortOrder',         ct.sort_order,
      'parentCharacterId', ct.parent_character_id
    ) ORDER BY ct.depth, ct.sort_order NULLS LAST), '[]'::json)
    FROM char_tree ct
  ) AS characters,
  (
    SELECT COALESCE(json_agg(json_build_object(
      'id',                st.id,
      'permid',            st.permid,
      'payload',           st.payload,
      'quantitative',      st.quantitative,
      'sortOrder',         st.sort_order,
      'parentCharacterId', st.parent_character_id,
      'parentStateId',     st.parent_state_id
    ) ORDER BY st.depth, st.sort_order NULLS LAST), '[]'::json)
    FROM state_tree st
  ) AS states
FROM target_schema ts;
`;

const byOrder = (a, b) => (a.sortOrder ?? Infinity) - (b.sortOrder ?? Infinity);
const sortedNodes = (entries) => entries.sort(byOrder).map((e) => e.node);

/**
 * Merge the flat character/state rows through their sources and nest them.
 * Each node's linkage and sort order is kept beside it, not in it.
 */
function assemble(row) {
  const chars = new Map();
  for (const c of row.characters) {
    const node = merge(characterSource, { jsonb: c.payload, columns: { permid: c.permid } });
    chars.set(c.id, { node, parentCharacterId: c.parentCharacterId, sortOrder: c.sortOrder, characters: [], states: [] });
  }

  const states = new Map();
  for (const s of row.states) {
    const node = merge(stateSource, { jsonb: s.payload, columns: { permid: s.permid, quantitative: s.quantitative } });
    states.set(s.id, {
      node, parentCharacterId: s.parentCharacterId, parentStateId: s.parentStateId, sortOrder: s.sortOrder, states: [],
    });
  }

  // States nest under a parent state, else under their parent character.
  for (const s of states.values()) {
    if (s.parentStateId != null) states.get(s.parentStateId).states.push(s);
    else if (s.parentCharacterId != null) chars.get(s.parentCharacterId).states.push(s);
  }

  // Characters nest under a parent character, else they are schema-level.
  const top = [];
  for (const c of chars.values()) {
    if (c.parentCharacterId != null) chars.get(c.parentCharacterId).characters.push(c);
    else top.push(c);
  }

  for (const c of chars.values()) {
    c.node.characters = sortedNodes(c.characters);
    c.node.states = sortedNodes(c.states);
  }
  for (const s of states.values()) s.node.states = sortedNodes(s.states);
  return sortedNodes(top);
}

/**
 * Read the nested characters (and their states) of a schema's current head by
 * `permid`. A permid with no current, non-removed head yields `[]`; the route
 * has already answered 404 from the head read in that case.
 *
 * @param {{ query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> }} pg
 * @param {string} permid
 * @returns {Promise<object[]>}
 */
export async function readSchemaCharacters(pg, permid) {
  const { rows } = await pg.query(SCHEMA_CHARACTERS_QUERY, [permid]);
  if (rows.length === 0) return [];
  return assemble(rows[0]);
}
