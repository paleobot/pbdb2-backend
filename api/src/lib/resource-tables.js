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
 * Relationship enrichment lands here as the optional `links` field. Foreign keys
 * are never stored in the JSONB; they live as columns on the enclosing table
 * (`reference_id`) or in a join table. The `links` config is consumed by the one
 * generic repository engine (see repository.js); a descriptor without it behaves
 * exactly as before. Other FKs (`early_age_id`, `enterer_person_id`, …) remain
 * unenriched. See design.md for the head-resolution rationale (the backend swing
 * trigger keeps these FKs pointed at the current head, so a plain join resolves
 * the current label + lineage permid).
 *
 * @typedef {object} FieldFilter
 * @property {string} jsonPath  JSONB key within the payload to match (e.g. 'publicationType')
 * @property {'eq'}   op        predicate kind — only equality today
 *
 * @typedef {object} ResourceDescriptor
 * @property {string} table        backing table name
 * @property {string} jsonbColumn  JSONB payload column on that table
 * @property {Record<string, LinkDeclaration>} [links]   declared link enrichment (output field → link)
 * @property {Record<string, FieldFilter>}     [filters] declared field filters (param → match spec)
 */

/**
 * Link targets: what a link declaration's `target` resolves to.
 *
 * The key is a ROUTE GROUP NAME, and it does double duty — it selects the SQL
 * source (table + payload column + label key) *and* it is the href base
 * appended to the citing group's parent prefix (see link-hydration.js). One
 * identifier for both jobs means the queried row and the URL that points at it
 * cannot drift apart, which a separate `hrefBase` field would invite.
 *
 * The projection emits no head filter for the target: it relies on the target
 * being either version-chained with FKs swung to head (`refs`, `authorities`)
 * or single-rowed per permid. A future target for which neither holds would
 * have to declare an explicit head filter, and this registry is where that
 * declaration belongs.
 *
 * `table` and `payloadColumn` are interpolated into SQL, so entries must be
 * plain lowercase identifiers (enforced in repository.js).
 *
 * @typedef {object} LinkTarget
 * @property {string} table          backing table of the target route group
 * @property {string} payloadColumn  JSONB payload column on that table
 * @property {string} label          JSONB key in that payload used as the link's label
 *
 * @type {Record<string, LinkTarget>}
 */
export const LINK_TARGETS = {
  references: { table: 'refs', payloadColumn: 'reference', label: 'title' },
  authorities: { table: 'authorities', payloadColumn: 'authority', label: 'citation' },
};

/**
 * A declared link from a resource to a target route group, keyed in `links` by
 * the output field name it produces. `via` names the column carrying the
 * foreign key: a column on this resource's table for a single-valued link, or a
 * column on `joinTable` for a many-to-many one. `on` states what that column
 * holds — the target's internal serial id, or the target lineage's `permid`
 * (which needs no id→permid translation).
 *
 * @typedef {object} LinkDeclaration
 * @property {string} target        target route group name (a {@link LINK_TARGETS} key)
 * @property {'id'|'permid'} on     what the `via` column holds
 * @property {string} via           FK column (e.g. 'reference_id')
 * @property {string} [joinTable]   many-to-many join table (e.g. 'additional_collection_refs')
 * @property {string} [joinKey]     join-table column pointing back at this table (e.g. 'collection_id')
 */

/** @type {Record<string, ResourceDescriptor>} */
export const RESOURCE_DESCRIPTORS = {
  references: {
    table: 'refs',
    jsonbColumn: 'reference',
    filters: { publication_type: { jsonPath: 'publicationType', op: 'eq' } },
  },
  authorities: {
    table: 'authorities',
    jsonbColumn: 'authority',
    links: {
      reference: { target: 'references', on: 'id', via: 'reference_id' },
    },
  },
  collections: {
    table: 'collections',
    jsonbColumn: 'collection',
    links: {
      primaryReference: { target: 'references', on: 'id', via: 'reference_id' },
      additionalReferences: {
        target: 'references',
        on: 'id',
        via: 'reference_id',
        joinTable: 'additional_collection_refs',
        joinKey: 'collection_id',
      },
    },
  },
  schemas: {
    table: 'schemas',
    jsonbColumn: 'schema',
    links: {
      primaryReference: { target: 'references', on: 'id', via: 'reference_id' },
      additionalReferences: {
        target: 'references',
        on: 'id',
        via: 'reference_id',
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

/**
 * Look up a link target by route group name, or undefined if that group is not
 * a declared link target.
 *
 * @param {string} group
 * @returns {LinkTarget | undefined}
 */
export function targetFor(group) {
  return LINK_TARGETS[group];
}
