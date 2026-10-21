## MODIFIED Requirements

### Requirement: A shared ajv factory registers the annotations
`createAjv()` SHALL return an ajv instance for draft 2020-12 (`ajv/dist/2020.js`), the schema dialect of OpenAPI 3.1, with `allErrors: true` and `strict: true`, except `strictRequired: false`. `x-create` merges as an `allOf` entry whose `required` names properties defined on the parent node, which that check rejects. `x-enumFrom`, `x-storage`, `x-create`, `x-link`, and `x-variant` (the root marker `deriveVariant` sets) SHALL be registered as annotation keywords, so that every variant compiles in strict mode. The converted migrations, the opinion migrations' attribution checks, the audit and the API's contract tests SHALL obtain their validators from `createAjv()`; none SHALL construct an ajv instance of its own.

Every annotated source and `opinionAttributionSchema` SHALL declare `$schema: "https://json-schema.org/draft/2020-12/schema"`, and every variant `deriveVariant` returns SHALL carry the same `$schema`, so that the draft schemas are tested under is the draft a published description applies.

#### Scenario: Strict compile succeeds
- **WHEN** each variant of each converted entity is resolved and compiled with `createAjv()`
- **THEN** compilation succeeds without unknown-keyword errors

#### Scenario: Every schema declares 2020-12
- **WHEN** each annotated source, `opinionAttributionSchema`, and each variant derived from a source is inspected
- **THEN** its `$schema` is `https://json-schema.org/draft/2020-12/schema`

#### Scenario: Attributions validate through the shared factory
- **WHEN** the opinions migration (`migrations/src/lib/attribution.js`) or the authority-opinions migration checks a built attribution
- **THEN** the validator it uses was compiled by `createAjv()` from `opinionAttributionSchema`
