/**
 * Per-entity data descriptor: the single source of truth mapping a resource
 * (the route group name) to its backing table and JSONB payload column.
 *
 * Note the deliberate mismatch: the `references` resource is backed by the
 * `refs` table (payload column `reference`). Centralizing it here keeps that
 * quirk in one tested place rather than scattered string literals.
 *
 * `specimens` is intentionally absent — no backing table exists in the backend
 * schema yet, so that route stays on stub data (see the change proposal).
 *
 * DEFERRED — relationship enrichment: foreign keys are never stored in the
 * JSONB; they live as columns on the enclosing table (`reference_id`,
 * `early_age_id`/`late_age_id`, the universal `enterer_person_id` /
 * `authorizer_person_id`, etc.). Exposing them as `links`/embeds is a later
 * change. This map is shaped so an optional `relationships` field can be added
 * to a descriptor WITHOUT restructuring callers. See design.md (Open Questions:
 * link-to-lineage vs. pin-to-version; the JOIN needed to resolve a FK's permid).
 *
 * @typedef {object} ResourceDescriptor
 * @property {string} table        backing table name
 * @property {string} jsonbColumn  JSONB payload column on that table
 */

/** @type {Record<string, ResourceDescriptor>} */
export const RESOURCE_DESCRIPTORS = {
  references: { table: 'refs', jsonbColumn: 'reference' },
  authorities: { table: 'authorities', jsonbColumn: 'authority' },
  collections: { table: 'collections', jsonbColumn: 'collection' },
  schemas: { table: 'schemas', jsonbColumn: 'schema' },
};

/**
 * Look up a resource's descriptor, or undefined if it has no backing table
 * (e.g. `specimens`).
 *
 * @param {string} resource
 * @returns {ResourceDescriptor | undefined}
 */
export function descriptorFor(resource) {
  return RESOURCE_DESCRIPTORS[resource];
}
