## 1. Rebase and permid machinery

- [x] 1.1 Rebase `identifications-rework` onto `origin/main` and resolve the conflicts (db/02-core.sql, occurrence-schema spec, mapping doc)
- [x] 1.2 Add the `ABD` prefix: digits in `permid_prefix_digits`, `permid_abd_seq`, the header comment

## 2. Schema

- [x] 2.1 Port `identifications` to text permids with the registry FK, `permid_no` and the one-head constraint
- [x] 2.2 Port `occurrence_abundances`; replace the version-1 unique index with the deferred exclusion constraint
- [x] 2.3 Port the derived `occurrences` and `derive_occurrences(text[])`
- [x] 2.4 Re-run the scratch-database scenarios against the prefixed DDL

## 3. Tests and docs

- [x] 3.1 Replace the `occurrences` cases in `api/test/integration/permids.test.js` with identification and abundance cases, and run them
- [x] 3.2 Update `migrations/src/occurrences-migration/docs/occurrences.md` with the permid sources
- [x] 3.3 `openspec validate port-identifications-to-prefixed-permids --strict`
- [x] 3.4 Archive and sync the deltas
