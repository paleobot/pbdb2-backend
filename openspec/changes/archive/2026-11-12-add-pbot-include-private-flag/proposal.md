## Why

Whether private PBot records are migrated is still an open question. The likely answer is "public only for now, private perhaps later". Today the token decides this by accident. `pbot-persons` and `pbot-schemas` always send `PBOT_TOKEN`, while `pbot-refs` never does. With a token that sees private records, the steps disagree about which records exist. That disagreement caused the 2026-11-10 failure, where private test schemas cited a reference that `pbot-refs` could not see.

PBot serves public records to anonymous visitors. Checked 2026-11-12, the anonymous result is a strict subset of what the token sees: Reference 291 vs 292, Schema 8 vs 10, Character 336 vs 342, State 1,326 vs 1,327. For the records both return, every field `pbot-refs` and `pbot-schemas` use is identical. Persons are different. Anonymous access returns all 325 persons but hides `Person.email` (96 have one with the token), and `pbot-persons` filters and matches on email. An anonymous run on 2026-11-12 filtered out all 325 persons and wrote nothing. So persons always need the token, while references and schemas can be read anonymously.

Including private records should be a deliberate, visible choice for each run. A command-line flag with a public-only default makes it one. The run log already records each run's arguments, and nothing in `.env` or the shell can switch it on unnoticed.

## What Changes

- New runner flag `--pbot-include-private`. Without it, `pbot-refs` and `pbot-schemas` read PBot anonymously and migrate public records only. With it, they send `PBOT_TOKEN` and migrate private records the token can see. The runner passes the flag on to those two steps, and both accept it when run directly.
- `pbot-refs` sends the token only with the flag. Today it never sends it, so a run with a private-capable token currently sees fewer references than `pbot-schemas`.
- `pbot-schemas` sends the token only with the flag. Today it always sends it. **BREAKING** for anyone relying on the token alone to bring in private schemas: they now also need the flag.
- `pbot-persons` always sends the token, because person emails are not public. Persons are the same 325 either way.
- Each PBot step logs its access at start: `token, including private records`, `anonymous, public records only`, or, for `pbot-persons`, `token (person emails are not public)`.
- Runner preflight requires `PBOT_TOKEN` when `pbot-persons` is selected, or when `--pbot-include-private` is given with `pbot-refs` or `pbot-schemas` selected. The environment line reports which PBot records the run includes.
- The runner rejects `--pbot-include-private` when neither `pbot-refs` nor `pbot-schemas` is selected, as it does other flag combinations that have no meaning.
- A small shared module, `migrations/src/lib/pbot.js`, holds the URL, the flag name, the headers and the access label, so the three steps and the runner cannot drift apart.
- `migrations/src/README.txt` and `.env.example` describe the flag and what `PBOT_TOKEN` is needed for.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `migration-runner`: new `--pbot-include-private` flag, passed on to `pbot-refs` and `pbot-schemas`. Preflight requires `PBOT_TOKEN` per step and flag, and reports the PBot record scope. The flag is rejected when no step it affects is selected.
- `pbot-refs-migration`: the Reference fetch is anonymous unless `--pbot-include-private` is given, in which case it carries the Bearer token. The step logs its access.
- `pbot-schema-migration`: the Schema, Character and State fetches are anonymous unless `--pbot-include-private` is given. The step logs its access.
- `pbot-person-migration`: the Person fetch always carries the Bearer token, because emails are not public (the spec does not mention the token today). The step logs its access.

## Impact

- **Source → target:** PBot GraphQL `Person`, `Reference`, `Schema`, `Character`, `State` → PostgreSQL `persons`, `refs`, `schemas`, `characters`, `states`, `additional_schema_refs`. No type mappings change. Only the set of source records `pbot-refs` and `pbot-schemas` see changes, and only when the flag is absent.
- **Code:** new `migrations/src/lib/pbot.js` and a unit test for it. `migrate-pbot-persons.js`, `migrate-pbot-refs.js`, `migrate-pbot-schemas.js` and `run-migrations.js` change, plus `.env.example` and `migrations/src/README.txt`.
- **Data integrity:**
  - Without the flag (the default from now on), localhost returns to the pre-11-10 totals: 71 PBot persons, 244 PBot refs, 8 schemas, 336 characters, 1,325 states (1 orphan, the self-parent state `ed088383`), 1 additional schema ref, `Refs via pbdbid: primary=0, additional=0`.
  - With the flag, all three steps see the same private records. `pbot-refs` now writes any private reference whose `pbdbid` is blank. Today's only private reference has a `pbdbid`, so the count is unchanged.
  - **Risk:** PBot may stop serving anonymous reads. A failed request already exits non-zero. A silently reduced result shows as lower counts in the run log.
  - **Risk:** a token without private access, used with the flag, gives the public result while the log says "including private records". The flag records intent; the counts show the outcome.
- **Anomalies:** none from the PBDB anomaly report apply; this concerns PBot access only.
- **Not in scope:** deciding whether private records should be migrated; the `pbdbid` fallback from `resolve-pbot-schema-refs-by-pbdbid`, which stays as it is.
