## Context

Three migration steps read the PBot GraphQL API at `https://pbot.paleobiodb.org/graphql`, and each has its own copy of the URL and the fetch:

| Step | Sends `PBOT_TOKEN` today | Needs the token for |
|---|---|---|
| `pbot-persons` | always, and exits if unset | `Person.email`, which anonymous access returns as null |
| `pbot-refs` | never | private references only |
| `pbot-schemas` | always (`main()` throws if unset) | private schemas, characters and states only |

The runner's `ENV_GROUPS.PBOT = ['PBOT_TOKEN']`, and all three steps declare it, so preflight demands the token even for `pbot-refs`, which never sends it.

On 2026-11-12 an anonymous fetch returned a strict subset of the token's records for every entity. Across the shared records, the only differing fields were `Person.email` and `Reference.enteredBy.Person.email`. `pbot-refs` requests that second field but never reads it. The first attempt at this change made the token optional for all three steps. Its anonymous rebuild found that `pbot-persons` filtered out all 325 persons, which led to this design.

## Goals / Non-Goals

**Goals:**
- Public-only is the default, and including private PBot records is an explicit choice on each run.
- `pbot-refs` and `pbot-schemas` always agree on which records they see.
- `pbot-persons` keeps full person data (emails) whichever scope is chosen.
- The run log shows which scope a run used.

**Non-Goals:**
- Deciding whether private records should be migrated.
- Checking that the token actually grants private access.
- Moving the rest of the PBot fetch logic (error handling, entity extraction) into a shared client.

## Decisions

### D1. A runner flag, not an environment variable

`--pbot-include-private` on the runner, passed on to the steps it affects as the same argument. It is not a variable such as `PBOT_INCLUDE_PRIVATE` in `.env`.

Whether this run includes private records is a per-run choice, and the runner's per-run choices are flags (`--createdb`, `--from`, `--only`). `.env` holds connection settings and credentials. Because of that, the token stays in `.env`. A flag also gives a safe default for free: forgetting it means public only, and no stale `.env` line or exported shell variable can switch private records on unnoticed. The run log already records the argument vector, so the choice shows in the log without new code.

*Alternative:* make the token itself the switch (unset means anonymous for every step). This was the first version of this change. It fails because `pbot-persons` needs the token whichever scope is chosen.

*Alternative:* a `.env` variable alongside the token. It works, but it is sticky across runs and invisible in the run log unless added there separately.

### D2. Which steps the flag affects

`pbot-refs` and `pbot-schemas` take the flag: anonymous without it, Bearer token with it. `pbot-persons` ignores it and always sends the token. The runner passes the flag only to the two steps that take it, which the step registry declares as `pbotRecords: true`.

The flag name says "include", not "private", because the run migrates public records plus the private ones the token can see, never private records alone.

### D3. A small shared module, `migrations/src/lib/pbot.js`

It exports:
- `PBOT_GRAPHQL_URL`
- `PBOT_INCLUDE_PRIVATE_FLAG = '--pbot-include-private'`
- `includePrivateRequested(argv = process.argv.slice(2))`: whether the flag is present.
- `pbotToken()`: the trimmed `PBOT_TOKEN`, or `null` when it is unset or blank.
- `pbotHeaders(useToken)`: the JSON content type, plus `Authorization: Bearer <token>` when `useToken` is true. It throws, naming `PBOT_TOKEN`, when `useToken` is true and there is no token.
- `pbotAccessLabel(includePrivate)`: `'token, including private records'` or `'anonymous, public records only'`.

The three steps use it in their existing `fetch` calls and drop their own URL constants and token checks. The runner uses the flag name and the label, so preflight and the steps describe the scope in the same words.

`pbotHeaders(true)` throws on a missing token instead of sending `Bearer ` with nothing after it. A step run directly without the runner's preflight still fails clearly, before any rows are written.

### D4. Runner preflight and validation

- `parseArgs` accepts `--pbot-include-private`.
- `validateArgs` rejects the flag when neither `pbot-refs` nor `pbot-schemas` is in the selection (e.g. `--from authorities --pbot-include-private`), before any connection. This follows the existing rule for flag combinations that have no meaning.
- Environment: `pbot-persons` keeps `env: ['PG', 'PBOT']`. `pbot-refs` and `pbot-schemas` declare `env: ['PG']` and `pbotRecords: true`, and preflight adds the `PBOT` group for them only when the flag is given. `ENV_GROUPS.PBOT` stays `['PBOT_TOKEN']`.
- When a `pbotRecords` step is selected, the preflight environment line ends with `— PBot records: <label>`.
- No separate PBot line in the run-log header: the flag in the `argv` line records the choice, and its absence means public only.

## Risks / Trade-offs

- **[PBot drops anonymous reads]** → A failed request already exits non-zero. A silently reduced result shows as lower fetched counts in the run log.
- **[The flag is used with a token that has no private access]** → The result equals the public run, while the label says "including private records". The counts in the log show what was actually fetched.
- **[Someone relied on the token to bring in private schemas]** → They must add the flag. The only private schemas today are the user's own test records.
- **[Resuming a private run with `--from authorities` and the flag]** → Rejected, with a message saying the flag affects no selected step. Drop the flag to resume.

## Migration Plan

1. Implement D1–D4. Update the unit test for `lib/pbot.js` (token trimming, headers with and without `useToken`, the throw on a missing token, flag detection).
2. The user restores `PBOT_TOKEN` in `.env`, since `pbot-persons` needs it.
3. Check that `--from authorities --pbot-include-private` is rejected before connecting.
4. Rebuild localhost with `--createdb` and no flag. Expect `PBot records: anonymous, public records only` in preflight and in the `pbot-refs` and `pbot-schemas` output, and the pre-11-10 totals: PBot persons +71, PBot refs +244, schemas 8, characters 336, states 1,325 with 1 orphan, additional schema refs 1, `Refs via pbdbid: primary=0, additional=0`.
5. The 2026-11-12 run (`27016b4`, token sent by `pbot-schemas` without a flag) stands as the private-records comparison. No flagged rebuild is needed.

Rollback: revert the commit. The steps return to their previous token handling, and the runner requires `PBOT_TOKEN` for all three PBot steps again.

## Open Questions

None. Whether private records are migrated stays the user's question, and this change only makes it a flag.
