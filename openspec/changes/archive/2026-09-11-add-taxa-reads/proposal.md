## Why

`taxa` is the resource the last two changes were built for. `add-pagination` and
`generalize-fk-enrichment` were both split out of this work because they were
cross-cutting; both have landed, and the measurements behind the taxa design are
already recorded in `docs/taxa-classification-reads.md` (517,226 rows, verified
again 2026-09-11).

Taxonomy is also the reason most people come to PBDB. Every resource served so
far — references, authorities, collections, schemas — is supporting evidence for
claims about taxa. Serving the taxa themselves is the first endpoint that answers
the question the database exists to answer.

`taxa` is structurally unlike every resource served so far, and the differences
are not cosmetic:

- **No JSONB payload.** Its content is typed columns (`name`, `rank_id`,
  `authority_id`, …). Both generic code paths — `makeReadRepository` and
  `linkProjections` — assume a JSONB payload column exists.
- **No version chain.** `HEAD_FILTER` references `succeeded_by_id`, a column
  `taxa` does not have. That is a SQL `42703` on every request, not a graceful
  degradation.
- **No write path, ever.** `taxa` is materialized output of `derive_taxa()`,
  upserted by `rebuild_taxa()`. The write surface for taxonomy is the *opinion*
  tables, which are separate resources not yet served.
- **A deep hierarchy.** Classification reaches depth 70, which makes the
  containing-taxa chain a per-endpoint decision rather than a field.

So this change is not a descriptor declaration. It adds the first read-only
resource shape, the first non-JSONB read path, and the first link target whose
label is a plain column.

## What Changes

- **Add the `taxa` route group** under the versioned base path: `GET /taxa` and
  `GET /taxa/{permid}`, in the standard envelope, with `meta.type` = `taxon`.
- **Add a taxa-specific read repository.** The generic one cannot serve `taxa`
  (no payload column, no version chain), so taxa gets its own module alongside
  `schema-tree.js` — reusing the shared `linkProjections()` rather than
  re-implementing link resolution.
- **Introduce the read-only resource shape in the route factory.** `taxa`
  exposes GET only; POST, PUT, PATCH and DELETE respond **405 Method Not
  Allowed** with an `Allow` header, not 404 and not a stubbed 200.
- **Extend `LINK_TARGETS` to express a plain-column label.** Today a target's
  label is always a JSONB key (`payload->>'title'`). `taxa.name` is a column, so
  the registry gains a way to say so — and `taxa` is registered as a link target
  (it is self-referential through `accepted`).
- **Add dictionary flattening.** `rank_id` and `nomenclatural_status_id` are
  integer FKs into small static dictionaries in the `dictionaries` PostgreSQL
  schema; they render as their text values (`rank`, `nomenclaturalStatus`).
- **Add the containing-taxa walk**, decoded from `classification_path` behind a
  single isolating function (see `design.md`). Always present on a single read;
  omitted from list items unless requested.
- **Add `?includeContainingTaxa=true`** as the list opt-in, accepted on `?ids=`
  reads as well. Accepts exactly `true` or `false`; anything else is a 400.
- **Replace provisional lenient query-param handling with strict rejection.** An
  unrecognized query parameter is now a 400 naming it, on single reads as well as
  lists. This reverses a requirement currently marked provisional in
  `resource-routes` and applies to every resource, not just `taxa`.

### Deliberately not included

- **No write path for taxonomy.** That means the opinion tables
  (`name_opinions`, `assignment_opinions`, `validity_opinions`), which are their
  own resources and their own change.
- **No taxa field filters.** No filter on `rank`, `name`, or anything else. The
  filter seam already exists and taxa can declare into it later; nothing is
  designed around its absence.
- **No `original_permid` / `accepted_spelling_permid` links.** `accepted` (from
  `concept_permid`) is the one self-link this change surfaces. The other two are
  real distinctions (they disagree on 195,141 rows) but have no consumer yet.
- **No opinion provenance.** `winning_name_opinion_id` and its siblings are the
  only provenance `taxa` carries, and they point at tables with no routes.
- **No `rank.height`.** Rank renders as its text value only.
- **No name ordering.** Lists stay `permid`-ordered, inheriting the keyset from
  `add-pagination`. A `(name, permid)` compound cursor is viable — names are
  nearly unique (10,669 rows share a name, max 7) — but the supporting index does
  not exist in the backend schema. The opaque cursor keeps this open.
- **No descendant reads, no ancestor/descendant search.** Only the root-ward
  chain from a taxon already located by `permid`.

## Capabilities

### New Capabilities

- `taxa-reads`: the taxa resource contract — its representation, the read-only
  verb surface, dictionary flattening, the containing-taxa chain and its per-
  endpoint rules, and the `includeContainingTaxa` opt-in.

### Modified Capabilities

- `resource-routes`: adds `taxa` as a sixth route group and the first read-only
  one, with 405 on write verbs; replaces the provisional lenient query-param
  requirement with strict rejection of unrecognized parameters.
- `reference-enrichment`: a link target's label may be a plain column instead of
  a JSONB key; `taxa` joins the target registry.

## Impact

- **Code:** a new `src/lib/taxa-repository.js` and a classification-path decoder;
  `src/lib/resource-tables.js` (plain-column label, `taxa` target + descriptor);
  `src/lib/repository.js` (`linkProjections` emits a column label; identifier
  check admits schema-qualified dictionary names); `src/lib/crud-routes.js`
  (read-only shape, 405); `src/lib/list-filters.js` (strict params, boolean
  opt-in); a new `src/routes/api/v1/taxa/index.js`.
- **API:** `taxa` is additive. Strict query-param handling is a **behavioral
  break on every resource**: a request carrying an unrecognized parameter now
  fails instead of succeeding with that parameter ignored.
- **Upstream:** none — `add-pagination` and `generalize-fk-enrichment` are the
  prerequisites and both have landed.
- **Downstream:** the opinion-table resources, which are where taxonomy's write
  path and provenance both live.
