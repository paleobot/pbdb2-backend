/**
 * The formatted `name` of an identification (occurrence-reads, "Formatted
 * identification name"; design D7): a display string composed from the rank
 * objects of a stored `identification` block. The structured ranks stay the
 * authoritative form; this is for reading.
 *
 * - Ranks in the order genus, subgenus, species, subspecies; the subgenus in
 *   parentheses, its qualifier inside them.
 * - `?`, `cf.`, `aff.`, `ex gr.` before the rank's name; so are the subspecies
 *   qualifiers `var`, `morph`, `forma`, `mut`, as stored.
 * - `n. gen.`, `n. subgen.`, `n. sp.`, `n. ssp.`, `sensu lato`, `sensu stricto`
 *   after it.
 * - `informal` and the ditto mark `"` are left out, and the name kept.
 * - A rank with no name is skipped; no rank name at all gives `null`.
 *
 * Stored names such as `sp.` and `indet.` are written as they are: nothing is
 * synthesized for a missing rank. Whether Classic marks informal names (with
 * angle brackets, say) is an open question; changing that is one rule here.
 */

const BEFORE = new Set(['?', 'cf.', 'aff.', 'ex gr.', 'var', 'morph', 'forma', 'mut']);
const AFTER = new Set(['n. gen.', 'n. subgen.', 'n. sp.', 'n. ssp.', 'sensu lato', 'sensu stricto']);

const RANKS = ['genus', 'subgenus', 'species', 'subspecies'];

/** One rank's name with its qualifier placed, or undefined when it has no name. */
function rankText({ resolution, name } = {}) {
  if (!name) return undefined;
  if (BEFORE.has(resolution)) return `${resolution} ${name}`;
  if (AFTER.has(resolution)) return `${name} ${resolution}`;
  return name; // informal, the ditto mark, or none
}

/**
 * @param {{ genus?: object, subgenus?: object, species?: object, subspecies?: object }} [ranks]
 *   the rank objects, `{ resolution?, name? }` each
 * @returns {string | null}
 */
export function identifiedName(ranks) {
  const parts = [];
  for (const rank of RANKS) {
    const text = rankText(ranks?.[rank]);
    if (text === undefined) continue;
    parts.push(rank === 'subgenus' ? `(${text})` : text);
  }
  return parts.length ? parts.join(' ') : null;
}
