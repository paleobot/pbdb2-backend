/**
 * Route/envelope-boundary hydration for resolved links. The persistence layer
 * (repository.js, schema-tree.js) emits pure `{ <label>, permid }` link objects
 * with no HTTP knowledge; this step adds the navigable `href` so the same object
 * is followable in both single reads and list items.
 *
 * `href` points at the linked lineage's read URL in its own target route group.
 * Because hydration runs over data already filtered for soft-removal
 * (suppression happens in SQL), no `href` can ever point at a removed resource.
 */

import path from 'node:path';

/**
 * Derive a target route group's base path from a citing route group's mounted
 * prefix — never a hard-coded literal. A group is mounted at e.g.
 * `/api/v1/collections`; its parent is the API version base (`/api/v1`), to
 * which the target group name is appended, giving `/api/v1/references`. This
 * adapts automatically to a future `v2` and assumes only that the target is a
 * sibling group under the same version prefix (it is, per the autoload layout).
 *
 * @param {string} prefix  the citing route group's `fastify.prefix`
 * @param {string} group   the target route group name (e.g. 'references')
 * @returns {string} that group's base path
 */
export function groupBase(prefix, group) {
  return path.posix.join(path.posix.dirname(prefix), group);
}

/**
 * Add `href = <target group base>/{permid}` to each resolved link object on a
 * record, for every field named by the `links` config. Each link's base comes
 * from its own `target`, so one record may carry links into different groups.
 * Mutates and returns the record. Safe for a `null` single-valued link, an empty
 * array, a missing field, or a missing `links` config — all no-ops.
 *
 * @template T
 * @param {T} record
 * @param {Record<string, import('./resource-tables.js').LinkDeclaration>} [links]
 * @param {string} prefix  the citing route group's `fastify.prefix`
 * @returns {T}
 */
export function hydrateLinkHrefs(record, links, prefix) {
  if (!record || !links) return record;
  for (const [as, link] of Object.entries(links)) {
    const value = record[as];
    if (value == null) continue;
    const base = groupBase(prefix, link.target);
    if (Array.isArray(value)) {
      for (const item of value) addHref(item, base);
    } else {
      addHref(value, base);
    }
  }
  return record;
}

function addHref(link, base) {
  if (link && link.permid) link.href = `${base}/${link.permid}`;
}
