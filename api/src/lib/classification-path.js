/**
 * Decoding for `taxa.classification_path`.
 *
 * This is the ONLY place the stored path's encoding is understood. The backend
 * schema explicitly reserves the right to reshape or drop `classification_path`
 * as a cache change (`create_new.sql` §9.7.4), so confining the decoding here
 * makes that reshape a one-file swap rather than a search through the read path.
 *
 * WHY THE PATH AT ALL. Adjacency (`containing_concept_permid`) is the PRIMARY
 * representation and the path is a derived materialization of it. Both were
 * measured (see `docs/taxa-classification-reads.md` §4–§5): the path agrees with
 * the adjacency chain across all 517,226 rows with zero disagreement, and the
 * recursive-CTE alternative is ~2× faster on a single deep read while the page
 * case is a wash. Performance does not decide it. The path wins because it is
 * already on the row you fetched, so depth and breadcrumbs cost no extra query,
 * and because deduplication across a page falls out naturally.
 *
 * THE FALLBACK. If the column is ever reshaped or dropped, the documented
 * replacement is a recursive CTE walking `containing_concept_permid` root-ward —
 * which is also what the backend's own DDL comment recommends for ancestor and
 * descendant *search* (a different problem: that comment explains why the GiST
 * index was dropped, and reading this column off a row already located by
 * `permid` uses no index). That implementation genuinely recurses and would need
 * its own iteration guard; this one needs none, because the path is a stored
 * value of fixed length, not a traversal.
 *
 * TWO TRAPS, both measured and both handled here:
 *
 *   1. ltree labels cannot contain `-`, so each element is a permid with its
 *      hyphens replaced by underscores. The round-trip is lossless because a
 *      UUID contains no underscores of its own.
 *   2. The last element is the row's own CONCEPT permid, not the row's permid,
 *      and the two differ for 30.7% of rows. It is never an ancestor, so it is
 *      always dropped.
 */

/** Separator between ltree path elements. */
const SEPARATOR = '.';

/**
 * Decode one ltree label back into a permid.
 *
 * @param {string} label
 * @returns {string} the permid in its canonical hyphenated form
 */
function labelToPermid(label) {
  return label.replaceAll('_', '-');
}

/**
 * Decode a stored `classification_path` into the taxon's ancestor concept
 * permids, ordered root-first.
 *
 * The final element — the taxon's own concept — is always dropped, so a root
 * taxon (a single-element path) yields an empty array. A null, empty or
 * unparseable path also yields an empty array: a taxon with no usable path is
 * read as having no ancestors rather than failing the whole read, which keeps a
 * backend reshape from turning every taxa request into a 500.
 *
 * @param {string | null | undefined} path  the raw `classification_path` value
 * @returns {string[]} ancestor concept permids, root-first, excluding the taxon
 */
export function ancestorPermids(path) {
  if (path == null) return [];

  const labels = String(path)
    .split(SEPARATOR)
    .filter((label) => label !== '');

  // Drop the last element: it names the taxon's own concept, never an ancestor.
  return labels.slice(0, -1).map(labelToPermid);
}

/**
 * Depth of a taxon in the classification, counting itself — the same value
 * `nlevel(classification_path)` reports. A root is depth 1.
 *
 * @param {string | null | undefined} path
 * @returns {number}
 */
export function pathDepth(path) {
  if (path == null) return 0;
  return String(path)
    .split(SEPARATOR)
    .filter((label) => label !== '').length;
}
