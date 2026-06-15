/**
 * The `schemas` read is the deliberate exception to the uniform repository: its
 * representation is an aggregate tree composing the schema head with its nested
 * characters and states. Adapted from pbdb2-migrations/play/server.js.
 *
 * Differences from that legacy query, by design:
 *  - Nodes are keyed by `permid` (the legacy exposed `pbotID`).
 *  - Internal serial ids and parent-link columns are used only to assemble the
 *    hierarchy in JS, then stripped — never exposed.
 *  - Every level filters to the current, non-removed version
 *    (`succeeded_by_id IS NULL AND NOT COALESCE(removed, false)`).
 *  - Reference enrichment (primaryReference / additionalReferences that the
 *    legacy resolved via JOIN) is DEFERRED with all relationship enrichment —
 *    see design.md. This returns schema payload + characters/states only.
 */

const SCHEMA_TREE_QUERY = `
WITH RECURSIVE
target_schema AS (
  SELECT s.id, s.permid, s.schema AS payload
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
  SELECT s.id, s.permid, s.state AS payload,
         s.parent_character_id, s.parent_state_id, s.sort_order, 0 AS depth
  FROM states s
  JOIN char_tree ct ON s.parent_character_id = ct.id
  WHERE s.succeeded_by_id IS NULL AND NOT COALESCE(s.removed, false)

  UNION ALL

  SELECT s.id, s.permid, s.state AS payload,
         s.parent_character_id, s.parent_state_id, s.sort_order, st.depth + 1
  FROM states s
  JOIN state_tree st ON s.parent_state_id = st.id
  WHERE s.succeeded_by_id IS NULL AND NOT COALESCE(s.removed, false)
)
SELECT
  ts.permid AS permid,
  ts.payload AS payload,
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
      'sortOrder',         st.sort_order,
      'parentCharacterId', st.parent_character_id,
      'parentStateId',     st.parent_state_id
    ) ORDER BY st.depth, st.sort_order NULLS LAST), '[]'::json)
    FROM state_tree st
  ) AS states
FROM target_schema ts;
`;

const byOrder = (a, b) => (a._sortOrder ?? Infinity) - (b._sortOrder ?? Infinity);

/**
 * Assemble the flat char/state rows into a nested tree, keyed by `permid`,
 * with internal ids used only for linkage and then stripped.
 */
function assemble(row) {
  const charMap = new Map();
  for (const c of row.characters) {
    charMap.set(c.id, {
      ...c.payload,
      permid: c.permid,
      _parentCharacterId: c.parentCharacterId,
      _sortOrder: c.sortOrder,
      characters: [],
      states: [],
    });
  }

  const stateMap = new Map();
  for (const s of row.states) {
    stateMap.set(s.id, {
      ...s.payload,
      permid: s.permid,
      _parentCharacterId: s.parentCharacterId,
      _parentStateId: s.parentStateId,
      _sortOrder: s.sortOrder,
      states: [],
    });
  }

  // States nest under a parent state, else under their parent character.
  for (const s of stateMap.values()) {
    if (s._parentStateId != null) stateMap.get(s._parentStateId).states.push(s);
    else if (s._parentCharacterId != null) charMap.get(s._parentCharacterId).states.push(s);
  }

  // Characters nest under a parent character, else they are schema-level.
  const topChars = [];
  for (const c of charMap.values()) {
    if (c._parentCharacterId != null) charMap.get(c._parentCharacterId).characters.push(c);
    else topChars.push(c);
  }

  for (const c of charMap.values()) {
    c.characters.sort(byOrder);
    c.states.sort(byOrder);
  }
  for (const s of stateMap.values()) s.states.sort(byOrder);
  topChars.sort(byOrder);

  // Strip the internal-only linkage/sort fields.
  for (const c of charMap.values()) {
    delete c._parentCharacterId;
    delete c._sortOrder;
  }
  for (const s of stateMap.values()) {
    delete s._parentCharacterId;
    delete s._parentStateId;
    delete s._sortOrder;
  }

  return { permid: row.permid, ...row.payload, characters: topChars };
}

/**
 * Read a schema's aggregate tree by `permid`, or null if there is no current,
 * non-removed schema head for it.
 *
 * @param {{ query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> }} pg
 * @param {string} permid
 */
export async function readSchemaTree(pg, permid) {
  const { rows } = await pg.query(SCHEMA_TREE_QUERY, [permid]);
  if (rows.length === 0) return null;
  return assemble(rows[0]);
}
