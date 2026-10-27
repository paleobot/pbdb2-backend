## Context

Every entity's permid is a UUIDv7 today (`permid-uuidv7`): a `uuid` column with a version-7
CHECK, minted in JavaScript by `migrations/src/lib/uuidv7.js` and, in the API tests, by
`newPermid()`. The advisory committee wants identifiers people can cite, and is likely to require
entity-prefixed sequence numbers, with migrated records keeping their Classic number. The user
also wants a check digit.

The reasoning so far is in `docs/api-design-backlog.md`, "Human-facing identifiers" (options A and
B, and "Leaning (2026-10-22)" as amended 2026-10-26 in ee804f7). This change carries out that
leaning: **option B, a prefixed sequence code that becomes the permid**. This document records the
decisions already made there and the questions still open. The backlog section has the full
reasoning and the rejected alternatives.

Current footprint:
- `db/02-core.sql`: 23 `permid … uuid` columns across 15 tables, most with the v7 CHECK.
  `subject_permid`, `target_permid`, `containing_permid`, `name_opinions_permid` and similar
  columns have no integrity check.
- `db/03-taxa.sql`: 59 uuid permid uses in the derived taxa tables and in
  `derive_taxa()`/`rebuild_taxa_full()` (uuid temp tables, `uuid[]` parameters, `::uuid` casts).
- `migrations/src`: 10 migration scripts mint through `lib/uuidv7.js`.
- `api/`: integration fixtures mint with `newPermid()` (strictly increasing UUIDv7). The taxa
  repository orders by permid because that was creation order. `classification-path.js` swaps
  `-` and `_` in ltree labels.
- `openspec/specs`: 17 specs mention UUIDs. `permid-uuidv7` is replaced.

No data conversion: the runner rebuilds everything from MariaDB and PBot.

## Goals / Non-Goals

**Goals:**
- Every exposed permid has the form `<PREFIX>-<number>-<CC>`, is minted by this database, and is
  stored as `text`.
- Migrated records keep their Classic number. Everything else gets a number from a sequence for
  each prefix, starting at a fixed floor.
- A `permids` registry is the FK target for every permid column, including the reference columns
  that have no check today.
- Lists and keyset pagination order by a generated `permid_no`, giving Classic order first and
  then creation order.
- The runner, the API reads and the integration tests all work on the new IDs, and the migration
  totals don't change.

**Non-Goals:**
- A resolver that accepts bare Classic numbers or absorbed authority `taxon_no`s (possible later,
  see the backlog).
- A `dictionaries.permid_prefixes` table (only if something needs the mapping as data).
- Write paths. The API is reads-only. `mint_permid()` is what future writes will call.
- Handles beside the permid (option A).

## Decisions

Settled in the backlog (2026-10-22, 2026-10-26). Repeated briefly here:

1. **The code is the permid (B), not a handle beside a UUID (A).** Under the committee's rules a
   handle would be a second permid of equal standing.
2. **Format `<PREFIX>-<number>-<CC>`**: decimal, no padding. `CC` is ISO 7064 MOD 97-10 over the
   whole uppercased ID with hyphens removed (A=10 … Z=35). Including the prefix catches a mistyped
   prefix. Zero-padding and a prefix in the middle were rejected.
3. **Storage**: `permid text`, plus `permid_no bigint GENERATED ALWAYS AS
   (split_part(permid, '-', 2)::bigint) STORED`. Versioned tables get a unique index on
   `permid_no` over heads. The text is the source of truth and FK target. Rejected for ordering:
   ICU numeric collation, plain `C` collation on the text, `created_at`.
4. **Registry** `permids(permid text COLLATE "C" PK, created_at)`. There is no `entity_type`
   column: the prefix already says it. Each permid column gets a CHECK on its own prefix, the
   format and the check digits, plus an FK to `permids`. `mint_permid(prefix)` refuses unknown
   prefixes. `created_at` is when the entity was created.
5. **Numbering by table**: refs, persons, collections and specimens use the Classic number.
   Authorities use `taxon_no`; a merged authority takes the lowest absorbed number, and the rest
   stay in `legacyIDs.oldpbdbIDs`. name_opinions uses `authorities.taxon_no` for authority-opinions
   root rows and the sequence for everything else. assignment/validity opinions, schemas,
   characters and states use the sequence only. PBot rows, sentinels and anything else with no
   Classic row use the sequence.
6. **Sequences**: one per prefix, starting at a fixed floor well above the Classic maximum (not
   max + 1, because Classic may keep taking writes). The runner sets every sequence before any
   non-legacy mint, as a setup step that doesn't read MariaDB.
7. **One change, not a sequence by layer.** The DDL, the migrations and the API reads have to
   switch together: the new schema rejects the old migration output, and the API can't read the
   new IDs without its changes. Tasks are grouped by layer within this change.
8. **`homonym_group_id` stays a UUID.** It is internal and never exposed.

## Risks / Trade-offs

- [Permids carry meaning and are enumerable] → Accepted. The data is public, and citeable
  continuity with Classic is the point.
- [Only this database can mint] → Accepted on the assumption that nothing outside it creates
  entities (Open Question 5). If that turns out to be wrong, A is the fallback.
- [Bulk inserts minting through `mint_permid()` row by row is slow at 517k rows] → See Open
  Question 6.
- [Sequence-numbered permids depend on run order] → Deterministic as long as the runner order is
  fixed. Legacy-numbered ones are deterministic regardless.
- [The rewrite is cheap only until permids are published or cited] → Land it before anything
  public exposes permids (Open Question 7).
- [`derive_taxa()` is large and uuid-typed throughout] → Its assertions and a full `taxa` runner
  step on localhost and Aurora must reproduce today's 525,805 rows.

## Migration Plan

Rebuild, not convert: apply the new DDL to a fresh database, run the full runner (with the new
sequence-floor setup step), then the taxa step. Compare totals with the last run, and check that
legacy-numbered permids are identical across two rebuilds. Do localhost first, then Aurora
`pbdb2_migration_test`. Rollback is the previous branch's DDL plus a rebuild.

## Open Questions

1. **Which tables get prefixes.** The backlog's numbering table covers refs, persons, collections,
   specimens, authorities, the three opinion tables, schemas, characters and states. The schema
   also has permids on **intervals, timescales, taxon_annotations and homonyms**. Each needs a
   prefix and a numbering rule, or an explicit "stays UUID for now" (as `homonym_group_id` does).
   Intervals and timescales aren't populated yet. The derived taxa tables (`taxa`,
   `taxa_linnaean`, `taxa_clades`, `taxa_attachments`, `cycle_cuts`) only carry other tables'
   permids and just change type.
2. **The prefix strings.** The examples disagree (`COL-` in the leaning, `COLL-` in B's sketch).
   A candidate set of three letters: `REF PER COL SPC AUT NAM ASG VAL SCH CHR STA` (+ interval,
   timescale, annotation if they're in). These appear in every citation, so they're worth
   showing to the committee.
3. **Floor values.** Classic maxima in `pbdb_2026_10_18`: collections 281,030; refs 96,229; taxa
   526,272; opinions 1,029,177; specimens 168,287; persons 1,332. One round floor everywhere (for
   example 10,000,000, which also makes non-legacy IDs visibly longer), or a floor per prefix?
4. **ltree labels.** `classification_path` stores concept permids with `-` replaced by `_`,
   because ltree labels used to forbid hyphens. PG16+ allows them (both environments are PG16+),
   so the swap in `03-taxa.sql` and `api/src/lib/classification-path.js` could be dropped. Leaning:
   drop it.
5. **Who mints?** The backlog's condition for choosing B: nothing outside this database (PBot
   writing independently, offline clients, bulk importers) creates entities. Confirm this, and
   state it in the proposal.
6. **Check digits in two languages.** SQL needs them for `mint_permid()` and the CHECK. The bulk
   migration inserts would otherwise call `mint_permid()` row by row. Options: (a) a JS helper
   that formats the ID from a legacy number or a block of `nextval`s, tested against the SQL
   function; (b) insert numbers and let SQL format the text (for example a set-based
   `mint_permids(prefix, n)` or a format function used in the INSERT). Leaning: whichever keeps a
   single definition of the algorithm, with a cross-check test if there are two.
7. **Is anything public yet?** If the docs page, OpenAPI examples or any deployed API already
   shows permids to outside users, it's worth knowing before the switch.
