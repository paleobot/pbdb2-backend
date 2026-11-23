## Why

The merged occurrence schema (`create-occurrences-schema`) models a reidentification as another `occurrences`
row that points at the one it supersedes, and leaves the current identification to be derived at read time.
That was the right call for a first cut, but it puts a second, unlike mechanism (`reidentifies_id` chains)
next to the opinion model the project already has for exactly this problem: many dated, attributed statements
about one subject, with a derived table that picks the winner. Taxonomy already solves it with
`name_opinions` → `derive_taxa()` → `taxa`.

An identification is that kind of statement: someone, citing a reference, asserts what a fossil in a
collection is. Treating the original identification as a *root* and each reidentification as a further
statement lets occurrences be a derived table, lets several identifications coexist, and keeps Classic's
unreliable "current" bookkeeping (`reid_no`, `most_recent`) out of the migration entirely, because the
migration loads every identification and derive picks the current one.

The migration script has not been written, so nothing built on the merged shape needs to be unwound.

## What Changes

- **BREAKING** (to the merged schema only; nothing consumes it yet): `occurrences` stops being a versioned
  entity table. It becomes a plain derived cache, upserted by permid like `taxa`, produced from
  `identifications`.
- Add `identifications`, a versioned table modelled on `name_opinions`: the root row of an occurrence mints it
  (its `permid` is the occurrence's `permid`), and every other row is a further identification that points at
  the root. `collection_id` is set only on the root. `reidentifies_id` is dropped.
- Add `derive_occurrences()` / `rebuild_occurrences()`: the winner is the identification citing the latest
  reference (publication year, as the opinions are ranked), with the lineage's first-entry time breaking ties
  so that correcting a typo does not change who wins. The derived row carries the winning name and inherits
  plant organs from older identifications. A removed root removes the occurrence. `rebuild_occurrences()`
  deletes orphaned rows as well as upserting.
- Add `occurrence_abundances`, a versioned table keyed by the occurrence's permid, replacing the `abundance`
  payload field. Plant organs stay in the identification payload, as in Classic.
- Split the payload schema: `identification.schema.js` (name, qualifiers, plant organs, comments, legacy ids)
  replaces `occurrence.schema.js`, and the abundance payload gets its own source.
- Rewrite the mapping document for the new target: every Classic occurrence row is a root identification, every
  reidentification a non-root one, and each non-null abundance an `occurrence_abundances` row.
- Retain unchanged from the merged design: nullable `taxon_permid` (name permid, not a FK), verbatim names in
  the payload, NOT NULL `collection_id`/`reference_id` with the 626 + 15 exclusions, `created_at` keeping
  Classic's `created`, and the finding that Classic's `reid_no` and `most_recent` are not to be read.

## Capabilities

### New Capabilities
- `identification-schema`: the `identifications` table, its root/non-root shape rules, and the identification
  payload schema.
- `occurrence-derivation`: `derive_occurrences()` and `rebuild_occurrences()`, the winner rule, the
  removed-root rule, and stable ids.
- `occurrence-abundance-schema`: the `occurrence_abundances` table and its payload schema.

### Modified Capabilities
- `occurrence-schema`: `occurrences` becomes a derived cache; the versioned-table and `reidentifies_id`
  requirements are removed, the collection/reference requirements move to the root identification, and the
  join-key and index requirements are restated for the new tables.

## Impact

- `db/02-core.sql`: replace the `occurrences` DDL with `identifications` and `occurrence_abundances`;
  `db/03-taxa.sql` or a new file holds the derived `occurrences` cache and its functions (the DDL-layout guard
  applies: the cache must come after the tables it derives from).
- `payloadSchemas/`: `occurrence.schema.js` and its fixture are replaced by identification and abundance
  sources; `tests/sources.test.js` is updated.
- `migrations/src/occurrences-migration/docs/occurrences.md` is rewritten. `docs/occurrences-excluded.csv` is
  unchanged. The archived `create-occurrences-schema` change is not edited: this change supersedes its D1,
  D2, D4 and D7 and says so in its design.
- Nothing references `occurrences(id)` today (no table has a FK to it), so replacing the table needs no
  data migration and no rollback. The follow-on migration script (still to be assigned) now targets
  `identifications` and `occurrence_abundances` and runs `rebuild_occurrences()` afterwards.
- Data-integrity risk: the winner rule depends on `created_at` being the true first-entry time. Classic's
  `created` is NULL on 66 occurrences; see design D4.
