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
 * Relationship enrichment lands here as the optional `references` field — the
 * concrete instance of the once-deferred `relationships` slot. Foreign keys are
 * never stored in the JSONB; they live as columns on the enclosing table
 * (`reference_id`) or in an additional-refs join table. The `references` config
 * is consumed by the one generic repository engine (see repository.js); a
 * descriptor without it behaves exactly as before. Other FKs (`early_age_id`,
 * `enterer_person_id`, …) remain unenriched. See design.md for the
 * head-resolution rationale (the backend swing trigger keeps these FKs pointed
 * at the current head, so a plain join resolves current title + lineage permid).
 *
 * @typedef {object} PrimaryReference
 * @property {string} as    output field name (e.g. 'reference', 'primaryReference')
 * @property {string} via   FK column on this table pointing at refs (e.g. 'reference_id')
 *
 * @typedef {object} AdditionalReferences
 * @property {string} as         output field name (e.g. 'additionalReferences')
 * @property {string} joinTable  many-to-many join table (e.g. 'additional_collection_refs')
 * @property {string} joinKey    join-table column pointing back at this table (e.g. 'collection_id')
 *
 * @typedef {object} ReferenceConfig
 * @property {PrimaryReference}      [primary]     single-FK reference
 * @property {AdditionalReferences}  [additional]  join-table references
 *
 * @typedef {object} ResourceDescriptor
 * @property {string}          table        backing table name
 * @property {string}          jsonbColumn  JSONB payload column on that table
 * @property {ReferenceConfig} [references] optional reference enrichment config
 */

/** @type {Record<string, ResourceDescriptor>} */
export const RESOURCE_DESCRIPTORS = {
  references: { table: 'refs', jsonbColumn: 'reference' },
  authorities: {
    table: 'authorities',
    jsonbColumn: 'authority',
    references: { primary: { as: 'reference', via: 'reference_id' } },
  },
  collections: {
    table: 'collections',
    jsonbColumn: 'collection',
    references: {
      primary: { as: 'primaryReference', via: 'reference_id' },
      additional: {
        as: 'additionalReferences',
        joinTable: 'additional_collection_refs',
        joinKey: 'collection_id',
      },
    },
  },
  schemas: {
    table: 'schemas',
    jsonbColumn: 'schema',
    references: {
      primary: { as: 'primaryReference', via: 'reference_id' },
      additional: {
        as: 'additionalReferences',
        joinTable: 'additional_schema_refs',
        joinKey: 'schema_id',
      },
    },
  },
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
