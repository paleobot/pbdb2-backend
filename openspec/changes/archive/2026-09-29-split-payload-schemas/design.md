## Context

`docs/monorepo-plan.md` describes the planned `pbdb2-backend` repo. `payloadSchemas/` stays at the root as a
lasting part of the backend, and all migration code moves under `migrations/`. The rule that makes the move
safe is that migrations may use anything, and nothing may use migrations.

An inventory of `payloadSchemas/` (3,784 lines, 27 files) shows it is already nearly self-contained:

```
payloadSchemas/
├── *.schema.js (9)       no imports at all
├── DESIGN_NOTES.md
├── lib/ (5)              imports ajv and siblings only; pg is always a parameter
│                         (loadEnums(pg,…), resolveEnums(pg,…), loadCodecContext(pg,…))
├── mappings/ (5)         legacy → 2.0 mapping docs; no code reads them        ◀ belongs to migrations
└── tests/
    ├── sources/storage/variants.test.js   pure
    ├── enums.test.js     ~12 pure tests + 2 DB tests; imports src/lib/pg-pool  ◀ crosses the line
    ├── dictionary-seeds.test.js  all DB; imports src/lib/pg-pool             ◀ crosses the line
    └── fixtures/         legacy-enums.json also read by a collections-migration test (allowed direction)
```

`src/lib/pg-pool.js` calls `process.exit(1)` when a `PG_*` variable is missing. `node --test` runs each file
in its own process, so today a missing `.env` fails `enums.test.js` and `dictionary-seeds.test.js` as whole
files (85 tests: 83 pass, 2 file-level failures). The other files are unaffected. The pure tests inside
`enums.test.js` are lost.

The mapping documents are edited by collaborators (`opinions.md` has five commits from NoisyFlowers).
`collections-pbot.txt` is currently byte-identical to `collections.txt`.

## Goals / Non-Goals

**Goals:**
- Nothing under `payloadSchemas/` imports or reads a file outside it, and a test proves it.
- Mapping documents live with the migrations they describe.
- The payload-schema DB tests fail per test, with a clear message, when the database is not configured.
- The monorepo docs describe this step accurately.

**Non-Goals:**
- A `package.json` of its own for `payloadSchemas/`. It needs workspaces, which the monorepo change brings.
- Rewording `*.schema.js` comments that cite migration scripts as the origin of stored shapes. They are
  provenance, not dependencies.
- Changing the seed-fidelity requirement in `payload-schema-enums`. It freezes the seeds at their
  conversion-time values and will need loosening once dictionaries are editable. That is API work.
- Moving `src/audit-payloads.js`, or consolidating the three copies of `PG_*` configuration (the migrations'
  pool, the API's `config.js`, the new test helper).
- Resolving the duplicate `collections-pbot.txt`.

## Decisions

### D1. Mapping documents go to `<migration>/docs/`, names unchanged

Each document belongs to one migration, so it sits in that migration's directory. Inside the directory,
`docs/` gives hand-maintained documentation its own position, distinct from `inputs/` (files the script
reads) and from the regenerated run artifacts at the root. That extends the reasoning
`migration-script-layout` already applies to inputs.

*Alternatives:* a shared `src/mappings/`, which keeps them together but detaches each document from its
migration, and when migrations retire, it is one more directory to remember; the migration directory's root,
where they would mix with gitignored run artifacts; `inputs/`, which is wrong because no script reads them.
Renaming them all to `mapping.md` would read better inside their directories, but it breaks collaborators'
muscle memory and the two collections files would still need distinct names. Names stay.

### D2. Seed-fidelity test stays in `payloadSchemas/`

`dictionary-seeds.test.js` checks that `create_new.sql`'s dictionary seeds equal the enum values the
migrated data was validated against. It exercises the DDL, not migration code, and it implements a
requirement of the lasting `payload-schema-enums` spec. Moving it under migration code would make a lasting
spec depend on migrations, which is the violation this change removes. Earlier planning notes listed it as
migration-only; that was wrong, and the docs are corrected in this change.

### D3. A tests-local pg helper that throws per test, never exits or skips

`payloadSchemas/tests/pg.js` exports a lazy getter and a closer, roughly:

```
getPg()    first call: check PG_* → throw Error("Missing PG_* variables: …") if any is absent;
           otherwise build the Pool (same options as src/lib/pg-pool.js, incl. PG_CA_CERT)
           later calls: the same Pool
closePg()  end the Pool if one exists; no-op otherwise
```

It loads `.env` through `dotenv/config`, like the migrations, so one `.env` at the repo root serves both.
DB tests call `getPg()` inside the test body, so a missing configuration fails exactly those tests. The
`after` hooks call `closePg()`.

*Why not skip:* the seed-fidelity test is the only check on `create_new.sql`'s seeds. A skip reports green,
and nobody notices it never ran. Skipping is right when running the database tests is a visible choice, for
example a separate `test:db` script, as the API has `test:integration`. Nobody here needs that today.

*Why not keep exiting:* the pure tests in `enums.test.js` are lost with the DB ones, and the failure is
reported per file, not per test.

*Why not share `src/lib/pg-pool.js` by moving it into `payloadSchemas/`:* that would reverse the rule,
because migrations would then import their connection pool from the payload-schemas package, and the pool's
exit-on-missing behaviour is right for migration scripts. About 25 lines are duplicated. Consolidating
connection configuration belongs to the monorepo change, if anywhere.

### D4. The guard test parses specifiers with regular expressions

The guard walks `payloadSchemas/**/*.js` and extracts:
- `from '…'` / `from "…"` (static imports and re-exports);
- `import '…'` (side-effect imports);
- `import('…')` with a string literal;
- `new URL('…', import.meta.url)`.

Specifiers starting with `.` are resolved against the file and must stay inside `payloadSchemas/`. Bare and
`node:` specifiers pass. Comment lines (`//`, and `*` inside block comments) are ignored, so provenance
comments don't trip it.

*Alternative:* a real parser (acorn, or `es-module-lexer`) would be exact but adds a dependency. The files
are plain ESM with conventional imports, and a false negative would need a computed specifier, which nothing
in the directory uses. If one ever appears, the guard can switch to a parser then.

### D5. The requirement lives in a new capability, `payload-schemas-boundary`

`payload-schema-variants` covers deriving variants and `payload-schema-enums` covers enum resolution. The
boundary cuts across both and also covers tests, so it gets its own small spec. The monorepo change is
expected to generalize it into a repository-wide rule (`db/`, `payloadSchemas/`, `api/` must not depend on
`migrations/`), either by extending this spec or by folding it into a new one.

## Risks / Trade-offs

- [Collaborators edit a mapping document at its old path on a branch] → git's rename detection carries
  edits across a merge or rebase. The new locations are announced when this lands.
- [A regex guard misses an unusual import form] → accepted (D4). The forms used today are covered, and the
  guard can be upgraded if a new form appears.
- [Duplicated `PG_*` config drifts from `src/lib/pg-pool.js`, e.g. a new SSL option] → only tests use it, and
  a drifted helper fails loudly in `npm test` against the real `.env`. It is also recorded as a Non-Goal for
  the monorepo change to revisit.
- [`dotenv/config` resolves `.env` from the working directory] → `npm test` runs at the repo root, as it does
  today. This is unchanged behaviour, not a new risk.

## Migration Plan

No data or schema changes. Verify with `npm test`, both with and without `PG_*` set as in the spec
scenarios, and confirm that the diff to `src/` is comment-only. A full `run-migrations` run is not needed,
because no executable line in a migration changes. Rollback is a revert of the commit.

## Open Questions

- `collections-pbot.txt` is identical to `collections.txt`, and no PBot collections migration exists yet.
  Is it a starting draft for one, or a leftover? It moves unchanged either way. Deciding its fate is outside
  this change.
