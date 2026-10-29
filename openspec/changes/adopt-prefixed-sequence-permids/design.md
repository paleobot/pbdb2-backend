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
   stay in `legacyIDs.oldpbdbIDs`. name_opinions uses the source `authorities` row's own `taxon_no` (one
   root row per source row, so an absorbed `taxon_no` still names its own name) for authority-opinions
   root rows and the sequence for everything else. assignment/validity opinions, schemas,
   characters and states use the sequence only. PBot rows, sentinels and anything else with no
   Classic row use the sequence.
6. **Sequences**: one per prefix, starting at a fixed floor well above the Classic maximum (not
   max + 1, because Classic may keep taking writes). Each sequence is created with its
   start in the DDL, so a database built from the DDL can mint at once and the runner needs no
   setup step (decided while writing the specs, 2026-10-27; the backlog had a runner step).
7. **One change, not a sequence by layer.** The DDL, the migrations and the API reads have to
   switch together: the new schema rejects the old migration output, and the API can't read the
   new IDs without its changes. Tasks are grouped by layer within this change.
8. **`homonym_group_id` stays a UUID.** It is internal and never exposed.

Settled while working through the open questions (2026-10-27):

9. **Prefixes.** Where a pbdb2 table means the same thing as a Classic data-service extended
   identifier (`col:12345`, data1.2 "identifiers" doc), it reuses that prefix, uppercased.
   Classic's `var` and `opn` are not reused: Classic opinions are split across three tables
   here, and the `txn`/`var` split doesn't map onto authorities and name_opinions. `txn` is
   reused for name_opinions, for readability rather than equivalence (revised by 20).

   | Table | Prefix | | Table | Prefix |
   |---|---|---|---|---|
   | refs | `REF` (Classic) | | name_opinions | `TXN` (was `NOP`; 20) |
   | persons | `PRS` (Classic) | | assignment_opinions | `AOP` |
   | collections | `COL` (Classic) | | validity_opinions | `VOP` |
   | specimens | `SPM` (Classic) | | taxon_annotations | `TAN` |
   | intervals | `INT` (Classic) | | schemas | `SCH` |
   | timescales | `TSC` (Classic) | | characters | `CHR` |
   | authorities | `AUT` | | states | `STA` |

   ~~**Reserved, not minted:** `TXL` (taxa_linnaean) and `TXC` (taxa_clades).~~ Dropped by 20:
   rows in those tables have no identity of their own, and their `permid` is already `TXN`.

   The separator stays `-` (Classic uses `:`, which ltree labels don't allow). A resolver for
   Classic's `col:12345` forms could come later; it's cheap because the number carries over.
10. **Names use name_opinions permids (`TXN`, was `NOP`; 20).** Names-as-spelled have no separate
    permid space: every root `name_opinions` row has `subject_permid = permid` (525,868 of 525,868
    on localhost), and `taxa_linnaean.permid`, `taxa_clades.permid` and the derived `*_permid`
    columns all hold that value. So a taxon name is cited as `TXN-<taxon_no>-<CC>`. Its number is
    the Classic `taxon_no`, the same number its authority has under `AUT`.
11. **Other permid columns.** `intervals` and `timescales` get prefixes now (both empty and
    unfinished; on migration, Classic `interval_no` and `scale_no` are their legacy numbers).
    `taxon_annotations` uses the sequence only. `homonyms.permid` is not an identity but a
    reference to a group member. It gets the CHECK and FK for `TXN`, and no prefix of its own. The
    derived taxa tables only change type and gain the `TXN` CHECK.
12. **One floor, 1,000,000, for every sequence.** It is above every Classic number that becomes a
    permid (the largest is `taxon_no` at 526,272), so sequence-numbered IDs are visibly one digit
    longer than any legacy ID. Classic `opinion_no` (up to 1,029,177) isn't carried into any
    table, so it doesn't constrain the floor.
13. **ltree labels hold permids as-is.** PG16+ allows `-` in labels, and permids contain only
    letters, digits and `-`. The `-`↔`_` swap goes from `db/03-taxa.sql` and
    `api/src/lib/classification-path.js`.
14. **The check-digit algorithm lives only in SQL.** Every permid needs a registry row before
    anything can reference it, so the migrations have to make a database round trip anyway. JS asks
    for formatted IDs in batches: `register_permids(prefix, bigint[])` for legacy numbers and
    `mint_permids(prefix, n)` for sequence numbers, both returning the text. The API never
    computes check digits (cursors use `permid_no`, and lookups go by the text), and the fixtures
    mint through SQL. There's one implementation and no cross-check test.
15. **Only this database mints, and nothing is public yet** (confirmed 2026-10-27). These were the
    backlog's conditions for B and for doing the rewrite now.

Settled while applying (2026-10-27):

16. **One head per number is a deferred exclusion constraint, not a unique index.** A partial unique
    index on `permid_no` is checked row by row. A new version is inserted as a head while the old
    head is still open (`handle_new_version()` closes it in its AFTER trigger), so the index rejected
    every new version (tested). Each versioned table instead has `<table>_one_head_per_number`,
    `EXCLUDE (permid_no WITH =) WHERE (succeeded_by_id IS NULL) DEFERRABLE INITIALLY DEFERRED`, checked
    at commit. Its index also serves list ordering. The derived taxa tables, like `persons`, have
    `permid_no … UNIQUE`.
17. **Tie-breaks on permids in the taxa functions sort by number.** Under UUIDv7 the last-resort
    tie-breaks (`original_permid ASC`, `cand.permid`) sorted in minting order; on text they would sort
    lexically (`NOP-100-…` before `NOP-99-…`). They now sort by `split_part(permid, '-', 2)::bigint`.
    The union-find representatives (`min(node)`) are only group labels, and take text order.
18. **Two PBot scripts mint one permid per insert.** `pbot-persons` (a later PBot person can match one
    inserted earlier in the run) and `pbot-schemas` (which rows insert is only known during the
    level-by-level parent resolution) can't know their rows up front. Both are small (~70 and ~1,700
    rows). Every other script registers or mints once per batch.
19. **`pbot-refs` no longer adds `UNIQUE (permid)` to `refs` at run time.** On a versioned table that
    constraint would reject every new version; `refs_one_head_per_number` does its job.

Revised after applying (2026-10-29):

20. **name_opinions uses `TXN`, not `NOP`.** A taxon's permid is its root opinion's permid (10), so
    the API's `/taxa` cited every taxon as `NOP-…`, which reads as "name opinion". This was always
    the case: the UUID version set `subject_permid = permid` on root rows too, but a bare UUID didn't
    show it. Renaming the prefix fixes how it reads and nothing else changes: same numbering (5),
    same sequence floor (12), and still one prefix per table that creates permids (4). `TXL` and
    `TXC` are dropped, not reserved. Verified on localhost before the revision: all 525,805 `taxa`
    and `taxa_linnaean` rows match a live root opinion, and no non-root opinion is a taxon.

    The name_opinions `*_permid` columns keep the name_opinions prefix. `subject_permid` and
    `target_permid` are read as pointing at a root opinion, not at a separate name entity; the
    data supports that, since every subject or target is a root row's permid.

    **What's left:** one `TXN` permid can mean two things. A root opinion and its taxon share one
    (`/taxa/TXN-n` and a future opinions endpoint), while a non-root opinion (`TXN-1000123-…`, a
    spelling or synonymy edge) is never a taxon. That was true of `NOP` and of UUIDs. It is
    harmless while links carry their `href` and nothing picks an endpoint from a permid's prefix.
    Two consequences to handle when they come up:
    - A resolver that takes a bare permid (`/permids/{id}`, Classic `txn:` redirects) needs a rule,
      e.g. a taxon if one exists, else the opinion. That's an API design decision for
      `docs/api-design-backlog.md`, not DDL.
    - The API docs should say that name opinions share the `TXN` space and only a root opinion's
      permid is also a taxon, so a 404 on `/taxa/TXN-1000123-…` is expected.

    **`TXN-n` is not promised to equal Classic `txn:n`.** Our n is the spelling's `taxon_no`.
    Classic's `txn:` is believed to use `orig_no` (unverified), with `var:` for spellings. They
    agree for original combinations and differ for respellings and recombinations. A Classic
    `txn:` resolver must check this first.

    **Rejected: a separate `TXN` permid space for the derived tables only** (opinions keep `NOP`,
    taxa map `NOP-n` → `TXN-n` in each `derive_*` and register `TXN` from a trigger on root
    inserts). It separates names from opinions at the prefix, but it's a lot of machinery for
    what is a readability fix. It stays open as a later change if the overlap becomes a real
    problem.

## Risks / Trade-offs

- [Permids carry meaning and are enumerable] → Accepted. The data is public, and citeable
  continuity with Classic is the point.
- [`TXN-526271-xx` and `AUT-526271-xx` share a number but are different records] → Intended: one
  Classic taxon, two pbdb2 views of it. The prefix and check digits keep them apart.
- [Only this database can mint] → Confirmed that nothing outside it creates entities. If that
  changes, an outside system calls `mint_permids()` or A becomes the fallback.
- [Bulk inserts minting row by row would be slow at 517k rows] → Batched
  `mint_permids`/`register_permids` calls (Decision 14).
- [Sequence-numbered permids depend on run order] → Deterministic as long as the runner order is
  fixed. Legacy-numbered ones are deterministic regardless.
- [The rewrite is cheap only until permids are published or cited] → Nothing is public yet.
  Land it before anything is.
- [`derive_taxa()` is large and uuid-typed throughout] → Its assertions and a full `taxa` runner
  step on localhost and Aurora must reproduce today's 525,805 rows.

## Migration Plan

Rebuild, not convert: apply the new DDL to a fresh database, run the full runner, then the taxa step. Compare totals with the last run, and check that
legacy-numbered permids are identical across two rebuilds. Do localhost first, then Aurora
`pbdb2_migration_test`. Rollback is the previous branch's DDL plus a rebuild.

## Open Questions

None. All seven were settled on 2026-10-27 (Decisions 9 to 15). The `NOP` → `TXN` rename (20)
was settled on 2026-10-29; implementing it is still to do.
