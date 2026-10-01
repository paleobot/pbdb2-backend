## Why

Relationship enrichment works, but only for one target. `referenceProjections`
hardcodes the `refs` table, the `reference` payload column, and the `title` label
key; `referencesBase` hardcodes the `references` route group. The descriptor's
config key is literally `references`. Every part of the seam assumes the thing
being pointed at is a reference.

The next resource breaks that assumption in two ways at once. `taxa` carries
`authority_id` — a foreign key into `authorities`, whose label lives at
`authority->>'citation'` and whose read URL is `/api/v1/authorities/{permid}` —
and `concept_permid`, a self-referential link into `taxa` that is *already* a
permid rather than a serial id.

The machinery is one substitution away from handling both: the projection
skeleton, the null/soft-removed suppression, the HTTP-agnostic split between
persistence and href hydration, and the descriptor-as-data pattern are all
correct and worth keeping. Only the hardcoded target needs to become a parameter.
Doing that now, as its own change, keeps it reviewable as what it is — a widening
with no behavior change — instead of burying a refactor of four files inside the
taxa change.

## What Changes

- **Generalize the enrichment target.** Introduce a link-target registry mapping
  a route-group name to the data needed to resolve it: backing table, JSONB
  payload column, and label key. `references` (→ `refs`, `reference`, `title`)
  and `authorities` (→ `authorities`, `authority`, `citation`) are the entries;
  `taxa` is added by its own change.
- **The target name does double duty.** It selects the SQL source *and* the URL
  base, because a route group's name is already how `referencesBase` derives an
  href from the mounted prefix. One name, both jobs, no second mapping to drift.
- **Support permid-keyed links alongside id-keyed ones.** A link declares whether
  its foreign key column holds a serial id (`r.id = row.reference_id`, today's
  only form) or a permid (`t.permid = row.concept_permid`). Permid-keyed links
  need no id→permid translation.
- **Rename the descriptor key and the helpers** from reference-specific to
  target-agnostic names (`references:` → `links:`; `referenceProjections` →
  `linkProjections`; `referencesBase` → `groupBase`;
  `hydrateReferenceHrefs` → `hydrateLinkHrefs`).
- **No observable behavior change.** Every existing enriched response —
  `authorities.reference`, `collections` and `schemas`
  `primaryReference`/`additionalReferences`, in single reads, list items, the
  schema aggregate tree, and the stub fallbacks — is byte-identical before and
  after. This change adds capability, it does not alter output.

### Deliberately not included

- **Dictionary flattening** (`rank_id` → `"genus"`). That resolves an integer FK
  into a small static dictionary with no `permid`, no route group, and therefore
  no `href` — a different kind of thing from linking to another resource. It
  belongs to the taxa change.
- Any new enriched field on any existing resource. `authorities` gains no
  outbound link here; it becomes a valid *target*, which is not the same thing.
- The `specimens` primary + additional pattern, still waiting on a backing table.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `reference-enrichment`: the contract generalizes from "references embedded from
  `refs`" to "a declared link to any route group's resource, embedded as
  `{ <label>, permid, href }`". The existing reference requirements are restated
  as instances of the general rule, with their observable behavior unchanged.

## Impact

- **Code:** `src/lib/resource-tables.js` (link-target registry; `references:` →
  `links:` in four descriptors); `src/lib/repository.js`
  (`referenceProjections` → target-parameterized `linkProjections`);
  `src/lib/reference-hydration.js` (`referencesBase` → `groupBase`;
  per-target href hydration — the file is renamed to `link-hydration.js`);
  `src/lib/crud-routes.js` and `src/lib/schema-tree.js` (consume the renamed
  helpers); the four route files that pass `descriptorFor(x).references`.
- **API:** none. No response changes, no new parameters, no new fields.
- **Naming:** the `reference-enrichment` capability ends this change broader than
  its name. Renaming it to `relationship-enrichment` is deferred to
  `add-taxa-reads`, where the second real instance actually lands and the rename
  stops being premature.
- **Downstream:** unblocks `add-taxa-reads`, whose `authority` and `accepted`
  fields become descriptor declarations rather than new machinery.
