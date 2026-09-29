## Context

`postgresql/create_new.sql` (8,827 lines) is the whole target DDL. Its contents, in file order:

| Lines | Content |
|---|---|
| 1–5 | `ltree` and `postgis` extensions, `dictionaries` and `lookup` schemas |
| 7–4700 | every `dictionaries.*` table with its seeds. The taxonomy dictionaries (`taxonomy_ranks`, `namechange_reasons`, `nomenclatural_statuses`) are at 42–212 and have long design headers. |
| 4700–4821 | versioning trigger functions (`swing_fks_to_new_version`, `place_in_lineage`, `handle_new_version`, `install_version_triggers`) |
| 4822–5037 | `persons`, `refs`, `timescales`, `intervals`, `lookup.intervals_timescales`, `collections`, `additional_collection_refs`, `specimens`, `schemas`, `additional_schema_refs`, `characters`, `states`, `authorities` |
| 5038–5100 | TAXA & OPINIONS preamble and LAYER 1 header (comments only) |
| 5101–5300 | `name_opinions`, `assignment_opinions`, `validity_opinions` |
| 5308–5380 | `taxa_linnaean` and its indexes (between the ledgers and the non-derived tables) |
| 5381–5430 | `taxon_annotations`, `homonyms` ("OUTSIDE THE STACK — non-derived data") |
| 5431–5450 | ledger indexes ("LAYER 1 INDEXES") |
| 5450–8827 | `cycle_cuts`, `taxa_clades`, `taxa_attachments`, `taxa`, and the `derive_*`/`rebuild_*`/`assert_*` functions, ending with `rebuild_taxa_full()` |

Only one piece of code reads the file: `applyCreateDb()` in `src/run-migrations.js`, which runs it as one
`pg` query for `--createdb`. Everything else (the payload-schema enum and seed tests) reads a database built
from it.

The dependencies already run one way. Taxa tables have foreign keys to `persons`, `refs`, `authorities`,
the ledgers and the dictionaries, and nothing in core has a foreign key into taxa. `specimens.name_opinions_permid`
is a plain `uuid`, and ledger `*_permid` columns are pointers without foreign keys by design.

## Goals / Non-Goals

**Goals:**
- Three files split by function, each readable on its own, with the tables the API writes in one short file.
- A database built from the three files that is identical to one built from `create_new.sql` today.
- The one-way dependency rule under test, so the split stays meaningful.

**Non-Goals:**
- Changing any table, constraint, function or seed.
- Moving the files to `db/` (the monorepo change does that).
- Splitting seed data from dictionary DDL, or splitting any file further.
- Deciding who owns which file. The split is functional. Ownership is a separate question (see
  `docs/monorepo-plan.md` and the exploration that led to this change).

## Decisions

### D1. Split by function: who writes the rows

- **Dictionaries** hold every `dictionaries.*` table and its seeds, taxonomy dictionaries included.
- **Core** holds what the API writes: versioned entities, the three opinion ledgers, and the hand-entered
  non-derived tables.
- **Taxa** holds what `rebuild_*()` writes, and the functions that compute and check it.

This test settles every object without a special case:

| Object | File | Why |
|---|---|---|
| `taxonomy_ranks`, `namechange_reasons`, `nomenclatural_statuses` | dictionaries | They're dictionaries. Only taxa use them, but that's a consumer, not a function. |
| `name_opinions`, `assignment_opinions`, `validity_opinions` + their indexes | core | Written by the API (append-only). They are the input to derivation, not its output. |
| `taxon_annotations`, `homonyms` | core | Hand-entered and never rebuilt, as their own header says. |
| `taxa_linnaean`, `taxa_clades`, `taxa_attachments`, `taxa` + their indexes | taxa | Rebuilt from the ledgers. |
| `cycle_cuts` | taxa | Only `rebuild_*()` writes it, and it's truncated on every rebuild. |
| `CREATE SCHEMA dictionaries` | dictionaries | |
| `CREATE SCHEMA lookup`, `CREATE EXTENSION postgis` | core | `lookup.intervals_timescales` and `collections.location` use them. |
| `CREATE EXTENSION ltree` | taxa | Only the taxa tables' `classification_path` uses it. |

*Alternatives considered*: splitting by author (the taxa derivation vs. everything else) was the starting
point, and was dropped for the functional rule. It would put the ledgers and the taxonomy dictionaries in
the taxa file, even though the API writes the ledgers and the dictionaries are ordinary lookups. A two-way
split (seed data vs. schema) would leave the core tables buried among the functions.

### D2. Numbered file names in `postgresql/`; the number is the load order

`01-dictionaries.sql`, `02-core.sql`, `03-taxa.sql`. The runner and the guard test both read
`postgresql/[0-9][0-9]-*.sql` in sorted order, so there's no load-order list to keep in sync, and
`cat postgresql/0*.sql | psql` works by hand.

*Alternatives considered*: unnumbered names plus a manifest (a list that has to be maintained, and
hand-built databases need to know about it); a `ddl/` subdirectory (a second relocation just before the
monorepo move, which renames `postgresql/` to `db/` anyway).

### D3. One-way rule, and where cross-file triggers go

A file may refer only to objects defined in itself or in files before it. "Refers" means any use in
executable SQL: a foreign key, a column type, a function call in a body, a trigger's table or function, a
string in dynamic SQL. Comments don't count.

A trigger on a core table that executes a taxa function goes in `03-taxa.sql`, after the function. The
planned ledger trigger (B2, "AFTER STATEMENT trigger (B2) takes it from there" in the LAYER 1 header) is
the expected first case. Defining a table's triggers next to the table is the natural reflex, which is why
the spec states this explicitly. The guard test would also catch it, because the trigger names a taxa
function.

### D4. `--createdb` concatenates the files into one query

`applyCreateDb()` reads the files in sorted order, joins them with newlines, and runs the result as one
query, exactly as it runs `create_new.sql` today. The existing atomicity reasoning still holds: no
meta-commands, no `COPY`, no explicit `BEGIN`/`COMMIT`, so it's one implicit transaction. The
populated-database guard also still holds, because the concatenation now starts with
`01-dictionaries.sql`'s `CREATE SCHEMA dictionaries`. The error handling doesn't change.

*Alternatives considered*: an explicit `BEGIN`, one query per file, then `COMMIT`/`ROLLBACK` on a checked-out
client. It would say which file failed, but it needs client checkout and release logic the runner doesn't
have today, and PostgreSQL's error message already names the failing object. We can add it if the missing
file name ever turns out to matter.

### D5. The guard test reads files; it doesn't build a database

`postgresql/tests/ddl-layout.test.js` runs in `npm test` with no database:
1. For each file, collect the names it defines: `CREATE TABLE`, `CREATE [OR REPLACE] FUNCTION`,
   `CREATE SCHEMA` and `CREATE EXTENSION` targets, schema-qualified where written that way.
2. For each file, strip `--` comments and search the rest for any name defined in a *later* file, matching
   whole words (`\b`), so `taxa` doesn't match `taxa_linnaean`. Matching is case-sensitive. The DDL writes
   every identifier in lower case, and a case-insensitive match reported seed text as a reference
   (`'United States'` in `admin0` → the core table `states`). During apply, those two seed rows were the
   only matches that differed between case-sensitive and case-insensitive matching.
3. Fail with `file:line: name (defined in later-file)` for each hit.

String literals are *not* stripped, because a name in dynamic SQL (`EXECUTE '… derive_taxa() …'`) is still a
dependency. Function bodies are searched too, for the same reason.

It also asserts that exactly `01-dictionaries.sql`, `02-core.sql` and `03-taxa.sql` exist. Adding a fourth
file should be a spec change, not something that happens silently.

*Alternatives considered*: building a database from core alone in the test. That's the stronger check,
but it would put a database dependency and a throwaway database into `npm test`. The equivalence check in
D6 builds the real thing once, at apply time.

### D6. Proving equivalence with `pg_dump`

Build one database from `create_new.sql` at the commit before the split (`git show <base>:postgresql/create_new.sql`)
and one from the three files. Compare the output of `pg_dump --schema-only` and
`pg_dump --data-only --schema=dictionaries` for the two. `pg_dump` orders objects by type and dependency,
not by source position, so reordering objects between files doesn't show up. Function bodies are dumped
verbatim, comments included.

That sets a rule for the split: **text inside function bodies moves byte for byte.** Only `--` comments
outside bodies (section headers, table notes) are split or reworded. The dumps must then match exactly,
with no diff to explain away.

A full migration run with `--createdb` then has to reproduce the current totals. That confirms the runner
change end to end.

### D7. Other specs' mentions of `create_new.sql` are reworded by hand, not by delta

`create_new.sql` appears in 16 requirements across `entity-versioning-triggers`, `permid-uuidv7`,
`taxa-opinions`, `taxa-unified`, `payload-schemas-boundary` and `payload-schema-enums`. Most are scenarios
("WHEN `create_new.sql` is applied to an empty database"). In all of them the behaviour stays the same and
only the file name changes. MODIFIED deltas would copy 16 whole requirements to change one noun each, and
that noise would bury the one real behaviour change (`migration-runner`).

These get a mechanical wording edit applied directly to the main specs during apply, like the 2026-08-12
format pass. "Applying `create_new.sql`" becomes "applying the DDL" (defined by `ddl-layout` as the three
files in load order), and a requirement that names where something lives names the specific file, for
example `payload-schema-enums`' "`postgresql/create_new.sql` SHALL create, in the `dictionaries`
schema" becomes `postgresql/01-dictionaries.sql`. Each edit is checked to change only the file reference.

`migration-runner` gets a real MODIFIED delta, because what `--createdb` executes does change.

### D8. History

The three files are built by slicing `create_new.sql`, then it's removed in the same commit. Git's rename
detection may pair it with `01-dictionaries.sql` (the biggest slice), and that doesn't matter.
`git log -- postgresql/create_new.sql` still shows the whole pre-split history, and
`git blame -C -C` on each new file traces moved lines to their original commits.

## Risks / Trade-offs

- **[Concurrent DDL edits]** A branch or `postgres-exploration` sync that edits `create_new.sql` after the
  split would have to be re-applied by hand to the right file. → Announce before applying, and land or
  hold pending taxa syncs first. Neither open branch (`graph-visuals`) nor the open change
  (`clade-hierarchy-user-guide`) touches the DDL today.
- **[Hidden ordering dependency]** An object moved to core might rely on something that is now in taxa. →
  Not possible through foreign keys (checked). Anything else fails loudly: the equivalence build (D6)
  applies the files in order, and the guard test (D5) catches it statically.
- **[Guard false positives]** Core code could contain a word that is also a taxa object name, such as `taxa`
  in a string literal, without it being a dependency. → None expected, since core contains no such
  literal today. If one appears, the test's `file:line` output makes it easy to judge, and the fix is to
  reword the literal or give the test a named exception, not to loosen the matching.
- **[Comment splitting loses context]** The TAXA & OPINIONS preamble explains the ledgers and the
  derivation together. Splitting it could leave either half hard to follow. → Each file gets a short header
  pointing to the other and to `docs/classic-taxa-opinions.md` §9.5, the full rationale.
- **[Hand-edited specs drift from deltas]** D7 edits main specs outside the delta mechanism. → Limited to
  a file-name substitution, listed in tasks, and checked with `openspec validate --all`.

## Migration Plan

1. Announce the new paths. Land or hold any pending `postgres-exploration` sync.
2. Apply: slice, update the runner, add the guard, reword the specs and docs.
3. Verify: `npm test`, equivalence dumps (D6), full migration run with `--createdb` reproducing the totals.
4. Rollback: revert the commit. No database built from the three files differs from one built from
   `create_new.sql`, so there's nothing to undo in any database.

## Open Questions

None.
