/**
 * Route/envelope-boundary hydration for resolved references. The persistence
 * layer (repository.js, schema-tree.js) emits pure `{ title, permid }` reference
 * objects with no HTTP knowledge; this step adds the navigable `href` so the
 * same object is followable in both single reads and list items.
 *
 * `href` points at the referenced lineage's read URL. Because hydration runs
 * over data already filtered for soft-removal (suppression happens in SQL), no
 * `href` can ever point at a removed reference.
 */

import path from 'node:path';

/**
 * Derive the `references` group base path from a citing route group's mounted
 * prefix — never a hard-coded literal. A group is mounted at e.g.
 * `/api/v1/collections`; its parent is the API version base (`/api/v1`), to
 * which `references` is appended, giving `/api/v1/references`. This adapts
 * automatically to a future `v2` and assumes only that `references` is a sibling
 * group under the same version prefix (it is, per the autoload layout).
 *
 * @param {string} prefix  the citing route group's `fastify.prefix`
 * @returns {string} the references group base path
 */
export function referencesBase(prefix) {
  return path.posix.join(path.posix.dirname(prefix), 'references');
}

/**
 * Add `href = <base>/{permid}` to each resolved reference object on a record,
 * for every field named by the `references` config. Mutates and returns the
 * record. Safe for a `null` primary, an empty `additionalReferences` array, a
 * missing field, or a missing `references` config — all no-ops.
 *
 * @template T
 * @param {T} record
 * @param {import('./resource-tables.js').ReferenceConfig} [references]
 * @param {string} base  from {@link referencesBase}
 * @returns {T}
 */
export function hydrateReferenceHrefs(record, references, base) {
  if (!record || !references) return record;
  for (const cfg of Object.values(references)) {
    const value = record[cfg.as];
    if (Array.isArray(value)) {
      for (const ref of value) addHref(ref, base);
    } else {
      addHref(value, base);
    }
  }
  return record;
}

function addHref(ref, base) {
  if (ref && ref.permid) ref.href = `${base}/${ref.permid}`;
}
