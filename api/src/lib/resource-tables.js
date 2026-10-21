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
 * Every version-chained resource here names a payload `source`, and its links
 * come from that source's x-link properties and items. The optional `links`
 * field is descriptor-declared enrichment for a resource with no source, which
 * today is only `taxa` (read by taxa-repository.js through linkProjections). A
 * descriptor link is single-valued: a column on the resource's own table. A
 * multi-valued link is declared in a payload source, as an array of links. Other
 * FKs (`early_age_id`, `enterer_person_id`, …) remain unenriched. See design.md
 * for the head-resolution rationale (the backend swing trigger keeps these FKs
 * pointed at the current head, so a plain join resolves the current label +
 * lineage permid).
 *
 * @typedef {object} FieldFilter
 * @property {string} jsonPath  JSONB key within the payload to match (e.g. 'publicationType')
 * @property {'eq'}   op        predicate kind — only equality today
 *
 * @typedef {object} ResourceDescriptor
 * @property {string} table          backing table name
 * @property {string} [jsonbColumn]  JSONB payload column, for resources that have one.
 *   Absent for a derived table of typed columns (`taxa`), which the generic
 *   repository cannot read.
 * @property {boolean} [readOnly]    the resource has no write path; write verbs answer 405
 * @property {object} [source]       annotated payload source (payloadSchemas/). When present,
 *   reads are built with merge() and links come from the source's x-link properties
 *   and items, so the descriptor declares no `links`.
 * @property {ChildTable[]} [children] child tables merge() reads for a source-backed
 *   resource, each keyed back to the parent row by `fk`. Which column joins a child
 *   table to its parent is a fact about tables, so it lives here, not in the source.
 * @property {Record<string, LinkDeclaration>} [links]      declared link enrichment (output field → link)
 * @property {Record<string, FieldFilter>}     [filters]    declared field filters (param → match spec)
 * @property {Record<string, Expansion>}       [expansions] declared expansion params (param → spec)
 *
 * @typedef {object} ChildTable
 * @property {string} table  child table name (e.g. 'additional_collection_refs')
 * @property {string} fk     its column holding the parent row's id (e.g. 'collection_id')
 *
 * @typedef {object} Expansion
 * @property {'boolean'} type  parameter kind — only booleans today
 */

import { authoritySource } from '../../../payloadSchemas/authority.schema.js';
import { collectionSource } from '../../../payloadSchemas/collection.schema.js';
import { referenceSource } from '../../../payloadSchemas/reference.schema.js';
import { schemaSource } from '../../../payloadSchemas/schema.schema.js';

/**
 * Link targets: what a link declaration's `target` resolves to.
 *
 * The key is a ROUTE GROUP NAME, and it does double duty — it selects the SQL
 * source (table + label source) *and* it is the href base appended to the
 * citing group's parent prefix (see link-hydration.js). One identifier for both
 * jobs means the queried row and the URL that points at it cannot drift apart,
 * which a separate `hrefBase` field would invite.
 *
 * A target declares its LABEL SOURCE in exactly one of two forms, because not
 * every linkable resource stores its content as JSONB:
 *
 *   payloadColumn + label   the label is a key inside a JSONB payload column
 *                           → `r.<payloadColumn>->>'<label>'`
 *   labelColumn             the label is a plain column on the table, and the
 *                           column name is also the emitted field name
 *                           → `r.<labelColumn>`
 *
 * `taxa` is the plain-column case: it is a derived table of typed columns with
 * no payload column at all. Declaring the form explicitly (rather than
 * inferring "no payloadColumn means a column") is deliberate — a target that
 * declares neither form throws a named error at projection time instead of
 * emitting SQL that fails with a 42703 against a column that does not exist.
 * That failure mode is exactly what shipped unnoticed inside a test fixture
 * before taxa arrived; see the change's design.md.
 *
 * The projection emits no head filter for the target: it relies on the target
 * being either version-chained with FKs swung to head (`refs`, `authorities`)
 * or single-rowed per permid (`taxa`, which declares `UNIQUE (permid)` and is
 * rebuilt in place). A future target for which neither holds would have to
 * declare an explicit head filter, and this registry is where that declaration
 * belongs.
 *
 * `table`, `payloadColumn` and `labelColumn` are interpolated into SQL, so
 * entries must be plain lowercase identifiers (enforced in repository.js).
 *
 * @typedef {object} LinkTarget
 * @property {string} table           backing table of the target route group
 * @property {string} [payloadColumn] JSONB payload column on that table
 * @property {string} [label]         JSONB key in that payload used as the link's label
 * @property {string} [labelColumn]   plain column used as the link's label, when
 *   the target has no JSONB payload; doubles as the emitted field name
 *
 * @type {Record<string, LinkTarget>}
 */
export const LINK_TARGETS = {
  references: { table: 'refs', payloadColumn: 'reference', label: 'title' },
  authorities: { table: 'authorities', payloadColumn: 'authority', label: 'citation' },
  taxa: { table: 'taxa', labelColumn: 'name' },
};

/**
 * A declared link from a resource to a target route group, keyed in `links` by
 * the output field name it produces. `via` names the column on this resource's
 * table carrying the foreign key; a descriptor link is single-valued. `on`
 * states what that column holds — the target's internal serial id, or the
 * target lineage's `permid` (which needs no id→permid translation).
 *
 * @typedef {object} LinkDeclaration
 * @property {string} target        target route group name (a {@link LINK_TARGETS} key)
 * @property {'id'|'permid'} on     what the `via` column holds
 * @property {string} via           FK column (e.g. 'authority_id')
 */

/** @type {Record<string, ResourceDescriptor>} */
export const RESOURCE_DESCRIPTORS = {
  references: {
    table: 'refs',
    jsonbColumn: 'reference',
    source: referenceSource,
    filters: { publicationType: { jsonPath: 'publicationType', op: 'eq' } },
  },
  authorities: {
    table: 'authorities',
    jsonbColumn: 'authority',
    source: authoritySource,
  },
  collections: {
    table: 'collections',
    jsonbColumn: 'collection',
    source: collectionSource,
    children: [{ table: 'additional_collection_refs', fk: 'collection_id' }],
  },
  schemas: {
    table: 'schemas',
    jsonbColumn: 'schema',
    source: schemaSource,
    children: [{ table: 'additional_schema_refs', fk: 'schema_id' }],
  },
  // `taxa` carries NO `jsonbColumn`: it is a derived table of typed columns. It
  // is therefore unreadable by the generic repository, which selects a payload
  // column and filters a version chain that `taxa` does not have — see
  // taxa-repository.js, and the guard in repositoryForResource().
  taxa: {
    table: 'taxa',
    readOnly: true,
    expansions: { includeContainingTaxa: { type: 'boolean' } },
    links: {
      authority: { target: 'authorities', on: 'id', via: 'authority_id' },
      // Self-referential: a taxon's accepted name is the row for its concept.
      accepted: { target: 'taxa', on: 'permid', via: 'concept_permid' },
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
