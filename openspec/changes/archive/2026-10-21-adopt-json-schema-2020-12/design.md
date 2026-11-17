## Context

The payload sources declare `$schema: "https://json-schema.org/draft/2019-09/schema"`, and
`createAjv()` (`payloadSchemas/lib/ajv.js`) builds an `ajv/dist/2019.js` instance. 2019-09 was the
minimum draft with `unevaluatedProperties`, which closes every derived variant; nobody chose it over
2020-12, which has the same keyword. `add-openapi-for-reads` (D7) will publish these schemas in an
OpenAPI 3.1 document, whose schema dialect is 2020-12, so the draft the tests run under would differ
from the draft readers and tools apply.

Who holds a draft today:
- nine `payloadSchemas/*.schema.js` files with a `$schema` (eight sources and
  `opinionAttribution.schema.js`); `deriveVariant` passes `$schema` through to every variant;
- `createAjv()`, used by the payloadSchemas tests, the converted migrations, the audit and the API's
  contract tests;
- two opinion migration modules that build their own `new Ajv({ allErrors: true, strict: false })`
  from `ajv/dist/2019.js` (`migrations/src/lib/attribution.js`,
  `migrations/src/authority-opinions-migration/migrate-authority-opinions.js`), although
  `payload-schema-variants` requires converted migrations to get validators from `createAjv()`;
- fixtures in `payloadSchemas/tests/variants.test.js`, and prose in `payloadSchemas/DESIGN_NOTES.md`
  and `api/docs/response-contracts.md`.

Probes against localhost before writing this (2026-10-21):
- the schemas use no keyword whose meaning changed between the drafts: no `$recursiveRef`, no
  array-form `items`/`additionalItems`, no `format`; `$defs` (in `schema.schema.js`) means the same
  in both;
- with `$schema` rewritten, **32 of 32** variants (8 sources × 4 variants) compile under a strict
  Ajv2020 configured like `createAjv()`;
- `opinionAttributionSchema` compiles under strict Ajv2020, so the two migration modules can use
  `createAjv()`;
- on 200 real rows each of collections, references and authorities, the 2019-09 and 2020-12 `out`
  validators give **identical verdicts** (all valid).

## Goals / Non-Goals

**Goals:**
- One draft, 2020-12, for every schema and every validator in the backend.
- Evidence that nothing validates differently: the same test results and the same audit totals.

**Non-Goals:**
- Any schema keyword change. A keyword whose meaning differs between drafts would be a finding to
  resolve here, but the probes found none.
- `createAjv()` options for querystring coercion: that belongs to `add-openapi-for-reads` (D7).
- Data changes. Stored jsonb is untouched.

## Decisions

### D1. Every schema declares 2020-12

The nine `$schema` values become `https://json-schema.org/draft/2020-12/schema`; derived variants
inherit it unchanged (`deriveVariant` already copies it, including into `patch-guard`). The
`unevaluatedProperties` comments in `opinionAttribution.schema.js` that say "new with Draft
2019-09" keep the history but drop the implication that 2019-09 is what is in use.

### D2. `createAjv()` returns an `ajv/dist/2020.js` instance, same options

`allErrors: true`, `strict: true`, `strictRequired: false` and the annotation keywords stay as they
are. The header comment states why 2020-12: the dialect of OpenAPI 3.1, so that tested and published
schemas use the same draft. `unevaluatedProperties` remains the reason a draft before 2019-09 would
not do.

*Alternative:* keep 2019-09 and strip `$schema` from the published document. Rejected in the
explore session: it leaves tested and published drafts different, with nothing checking that they
agree.

### D3. The opinion migrations validate through `createAjv()`

`attribution.js` and `migrate-authority-opinions.js` replace their own Ajv2019 with `createAjv()`,
as `payload-schema-variants` already requires of converted migrations. This removes the last direct
`ajv/dist/2019.js` imports. Strict mode affects schema compilation, not validation outcomes, and
`opinionAttributionSchema` compiles under it (probe), so their behavior does not change. No test in
`npm test` covers these modules (only the database-driven `opinions-migration/tests/run-migration.js`
references them), and the audit does not check attributions, so D5 checks the stored data directly.
Probe on localhost: every stored attribution (name_opinions 546,498, assignment_opinions 128,951,
validity_opinions 166) is valid under both today's validator (2019-09, `strict: false`) and a strict
2020-12 `createAjv()`-style validator, with **no verdict differences**.

*Alternative:* switch them to `ajv/dist/2020.js` with `strict: false`. Rejected: it keeps a second
validator configuration for one schema, which is what `createAjv()` exists to prevent.

### D4. A test pins the draft

`payloadSchemas/tests/sources.test.js` asserts that every source and `opinionAttributionSchema`
declares 2020-12, and that every derived variant carries it. A stray 2019-09 `$schema` would
otherwise fail only at compile time, and only in a validator that happens to reject it. A scan for
`ajv/dist/2019.js` imports is not added: after D3 none remain, and the payloadSchemas boundary
forbids that test from reading `migrations/` or `api/`.

### D5. Verified by unchanged results, including the audit

`npm test` and `npm run test:integration` pass unchanged apart from the fixtures that name the
draft. `node migrations/src/audit-payloads.js` runs against localhost **before and after** the
change, and its per-entity summary lines (`audit <entity>: checked=<n> violations=<n>`) must match.
The audit validates every stored row, superseded versions included, so this is the whole-database
check that the drafts agree. It covers the eight sources, not `opinionAttribution`, so the stored
`attribution` values of the three opinion tables are validated with the changed `createAjv()` as
well, and the counts must match the probe above (675,615 valid, 0 invalid).

## Risks / Trade-offs

- [A keyword behaves differently under 2020-12 on some row the probes did not see] → the audit
  before/after comparison covers every stored row, not a sample.
- [The opinion migrations behave differently under strict compilation] → strictness is
  compile-time only, and every stored attribution is validated with the new validator (D5). The next
  full runner run also reproduces the opinions totals.
- [`migrations/migration_exploration/lib/attribution.js` keeps its own Ajv2019, which cannot
  compile a schema declaring 2020-12, so that superseded tree breaks on import] → accepted:
  `migration_exploration` is superseded and may break (it is outside every spec and test); it is
  not updated.
- [JSON Hyper-Schema, considered in `response-contracts.md` §5, exists only for 2019-09] → it was an
  alternative, not adopted. The doc's "the draft the payload schemas already use" becomes untrue and
  is corrected; the alternative itself is unaffected, since it already notes there is no 2020-12
  hyper-schema.

## Migration Plan

One commit: schemas, `createAjv()`, the two migration modules, fixtures, specs and docs together.
No stored data changes. Rollback is reverting the commit.

## Open Questions

None.
