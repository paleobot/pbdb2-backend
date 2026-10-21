## MODIFIED Requirements

### Requirement: One annotated source per converted entity
`payloadSchemas/collection.schema.js`, `payloadSchemas/specimen.schema.js`, `payloadSchemas/person.schema.js`, `payloadSchemas/reference.schema.js`, `payloadSchemas/authority.schema.js`, `payloadSchemas/schema.schema.js`, `payloadSchemas/character.schema.js`, `payloadSchemas/state.schema.js` and `payloadSchemas/taxon.schema.js` SHALL each export a single annotated source schema describing the entity object as the API sees it. The object SHALL NOT be wrapped in a `{ collection }`, `{ specimen }`, `{ person }`,
`{ reference }`, `{ authority }`, `{ schema }`, `{ character }`, `{ state }` or `{ taxon }` envelope. None of the nine files SHALL export a hand-maintained variant
(`collectionMigrationSchema`, `completeCollectionProperties`, `personSchema`, `referenceSchema`,
`authoritySchema`, `schemaSchema`, `characterSchema`, `stateSchema`, `createSchema`, `editSchema`, `patchSchema`, `getSchema`), fastify `response` blocks, or
`getPropertiesForPubType`. Every variant SHALL be obtained through `deriveVariant`.

#### Scenario: No hand-maintained variants remain
- **WHEN** the nine modules are imported
- **THEN** each exposes only its annotated source (plus optional non-schema helpers), and none of the listed names is exported

#### Scenario: Person source is not enveloped
- **WHEN** `payloadSchemas/person.schema.js` is imported
- **THEN** it exports `personSource`, whose `properties` are the person's own fields, and it does not export `personSchema`

#### Scenario: Reference source is not enveloped
- **WHEN** `payloadSchemas/reference.schema.js` is imported
- **THEN** it exports `referenceSource`, whose `properties` are the reference's own fields, with no `reference` wrapper and no `allowDuplicate`, and it does not export `referenceSchema` or `getSchema`

#### Scenario: Authority source is not enveloped
- **WHEN** `payloadSchemas/authority.schema.js` is imported
- **THEN** it exports `authoritySource` (and `default`), whose `properties` are the authority's own fields with no `authority` wrapper, and it does not export `authoritySchema`

#### Scenario: Schema source is not enveloped
- **WHEN** `payloadSchemas/schema.schema.js` is imported
- **THEN** it exports `schemaSource` (and `default`), whose `properties` are the schema's own fields with no `schema` wrapper, and it does not export `schemaSchema`

#### Scenario: Character and state sources are not enveloped
- **WHEN** `payloadSchemas/character.schema.js` and `payloadSchemas/state.schema.js` are imported
- **THEN** they export `characterSource` and `stateSource` respectively (each also as `default`), whose `properties` are the entity's own fields with no `character` or `state` wrapper, and neither exports `characterSchema` or `stateSchema`

### Requirement: Variants are derived by a pure function
`deriveVariant(source, variant)` SHALL accept `variant` ∈ {`db`, `in-create`, `patch-guard`, `out`}, return a new schema, and SHALL NOT modify `source`. It SHALL apply its rules recursively through `properties`, `items`, `allOf`, `anyOf`, `oneOf`, `if`, `then`, and `else`. Each variant SHALL have `$id` `https://pbdb2.example.com/schemas/<entity>.<variant>.json`. `db`, `in-create`, and `out` SHALL keep `unevaluatedProperties: false` at the entity root. Any other variant name SHALL throw.

A source whose root declares `readOnly: true` has no write path. For such a source `deriveVariant` SHALL throw for `in-create` and `patch-guard`, naming the source as read-only, and SHALL derive `db` and `out` as for any source.

#### Scenario: Source untouched
- **WHEN** all four variants are derived from the collection source
- **THEN** a deep comparison of the source before and after shows no change

#### Scenario: Unknown variant
- **WHEN** `deriveVariant(source, 'in-update')` is called
- **THEN** it throws listing the four valid variant names

#### Scenario: A read-only source has no write variants
- **WHEN** `deriveVariant(taxonSource, 'in-create')` or `deriveVariant(taxonSource, 'patch-guard')` is called
- **THEN** it throws, naming the taxon source as read-only
- **AND** `deriveVariant(taxonSource, 'out')` returns the response schema

### Requirement: A shared ajv factory registers the annotations
`createAjv(options)` SHALL return an ajv instance for draft 2020-12 (`ajv/dist/2020.js`), the schema dialect of OpenAPI 3.1, with `allErrors: true` and `strict: true`, except `strictRequired: false`. `options` SHALL be merged over those defaults, so that a caller validating query strings can add type coercion; called with no argument it SHALL behave exactly as before. `x-create` merges as an `allOf` entry whose `required` names properties defined on the parent node, which that check rejects. `x-enumFrom`, `x-storage`, `x-create`, `x-link`, and `x-variant` (the root marker `deriveVariant` sets) SHALL be registered as annotation keywords, so that every variant compiles in strict mode. The converted migrations, the opinion migrations' attribution checks, the audit and the API's contract tests SHALL obtain their validators from `createAjv()`; none SHALL construct an ajv instance of its own.

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

#### Scenario: Options extend the defaults
- **WHEN** `createAjv({ coerceTypes: true })` compiles `{ type: 'integer' }`
- **THEN** it accepts `"5"`, and `createAjv()` with no argument rejects it
- **AND** both instances register the annotation keywords and run in strict mode

## ADDED Requirements

### Requirement: The taxon source
`payloadSchemas/taxon.schema.js` SHALL export `taxonSource` (and `default`), the taxon as the API reads it: `permid`, `name`, `rank`, `nomenclaturalStatus`, `authority` and `accepted` (`taxa-reads`). It SHALL declare `readOnly: true` at its root, because `taxa` is derived output with no write path. Every property SHALL carry `x-storage` naming the `taxa` column it is read from (`permid`, `name`, `rank_id`, `nomenclatural_status_id`, `authority_id`, `concept_permid`), since nothing is stored as jsonb; its `db` variant is therefore an empty object. `rank` and `nomenclaturalStatus` SHALL carry `x-enumFrom` naming `taxonomy_ranks.taxonomy_rank` and `nomenclatural_statuses.status`; `nomenclaturalStatus` SHALL allow `null`. `authority` SHALL be `link({ target: 'authorities', label: 'citation' })` and `accepted` SHALL be `link({ target: 'taxa', label: 'name' })`.

The `containingTaxa` chain is not part of the source: it is an expansion composed by the API. `taxa` reads do not use `merge()`; the source describes the response and conformance tests keep it true.

#### Scenario: The taxon out variant describes a taxon response
- **WHEN** a taxon single read's `data`, without `containingTaxa`, is validated against `deriveVariant(taxonSource, 'out')`
- **THEN** it is valid

#### Scenario: The taxon source stores nothing in jsonb
- **WHEN** `deriveVariant(taxonSource, 'db')` is derived
- **THEN** it declares no properties
