## Context

The `add-multi-get-ids-filter` change introduced `collectListFilters` (the query
seam) and `repository.readHeads(permids)` alongside `repository.list()`. `ids` is
universal — every resource has a `permid` — so the seam could hardcode it. The
first content filter, `references?publication_type=book`, is different on two
axes: it is **entity-specific** (only references have a publication type) and it
reads a field **inside the JSONB payload** (`reference->>'publicationType'`),
not the row identity.

Those two differences drive the whole design: the seam can no longer own the
knowledge of which params exist (that must come from the resource), and the
repository's two read methods (`list` / `readHeads`) can no longer stay separate
(a third predicate, composing with `ids`, makes the method-combination explode).
This change resolves both, and does so with one eye on the deferred `pbdb2-dev`
JSON Schema integration, which will later become a richer source for the same
declarations.

## Goals / Non-Goals

**Goals:**

- Per-entity field filters, declared as data per resource, with
  `references?publication_type=` as the first instance.
- One composable head read: `HEAD_FILTER` + optional `ids` + optional field
  predicates, assembled into a single `WHERE`, so filters compose with the
  multi-get.
- A filter pipeline split into `define` → `validate` → `translate` so the
  `validate` stage can later be filled by the schema without reshaping consumers.
- Lenient defaults recorded as provisional, with the schema-driven tightenings
  named as planned follow-ups.

**Non-Goals:**

- Loading or deriving anything from the JSON Schemas (not wired yet).
- A hardcoded publication-type enum, multi-value (`IN`) filters, non-`eq`
  operators, or range/type-coerced fields.
- The JSONB expression index (a `pbdb2-migrations` concern).
- Strict unknown-param or unknown-value rejection (deferred to schema arrival).

## Decisions

### Filter definitions are data, declared in the descriptor

Add a `filters` map to each resource's descriptor in `resource-tables.js`,
parallel to the existing `references` enrichment config:

```js
references: {
  table: 'refs',
  jsonbColumn: 'reference',
  filters: { publication_type: { jsonPath: 'publicationType', op: 'eq' } },
}
```

The map captures the snake_case-param ↔ camelCase-JSONB-key translation and the
predicate kind as plain data. _Why:_ the seam and repository consume the
*structure*, indifferent to whether a human authored it (now) or a JSON-Schema
loader generates it (later). Route files stay unchanged — they already pass the
descriptor through `repositoryForResource`. _Alternative:_ declare filters in
each route file — rejected; it scatters the same kind of mapping the descriptor
already centralizes, and breaks the "one tested place" property.

### Unify `list` / `readHeads` into one predicate-assembled head read

Replace the two methods with one that builds its `WHERE` from contributors:

```
readHeads({ ids?, fields? })
  predicates = [ HEAD_FILTER ]
  + ids?    → permid = ANY($n)
  + fields? → <jsonbColumn>->>'<jsonPath>' = $n   (one per field filter)
  SELECT … WHERE <predicates joined by AND> ORDER BY permid
```

A bare list passes no criteria (just `HEAD_FILTER`); `ids` alone reproduces the
current multi-get; `publication_type` alone filters content; together they
`AND`. _Why:_ `publication_type` is a third predicate, and `?ids=&publication_type=`
must compose — separate methods would force a `readHeadsFiltered` /
`listFiltered` combinatorial mess. The `add-multi-get-ids-filter` design already
described this "single `WHERE` from contributors" model but built `readHeads` as
a sibling of `list`; this change finishes that idea. _Alternative:_ add a third
method — rejected for the combinatorial reason above.

### `ids` accounting is suppressed when a field filter composes with it

`meta.requested` / `meta.missing` is the pure multi-get's partial-success signal:
it answers "which of the requested ids have no current head?". That question is
only well-defined when the id set is the *sole* constraint — absence from the
result then has exactly one cause (no head). Add a field filter and absence gains
a second cause (exists but filtered out), so `missing` can no longer carry one
clear meaning. Rather than overload it (report filtered-out ids as missing — a
half-truth) or pay a second existence query to preserve a signal of marginal
value in a filtered query, the accounting is **withheld** when `ids` and a field
filter combine. This yields a clean invariant — *`missing` present ⟺ the id set
is the sole constraint* — making its presence itself a mode indicator. _Surfaced
during implementation:_ the composition test exposed that the first cut reported
a filtered-out-but-existing id as missing, which contradicts the shipped `ids`
definition of "missing = no current head." _Alternatives:_ existence-only
(`missing` always means non-existence, costs an extra query) and overload
(`missing` = anything not returned, diverges from the shipped contract) — both
rejected; see proposal/exploration.

### A three-stage filter pipeline: define → validate → translate

Keep the stages distinct even though two are trivial today:

- **define** — the descriptor `filters` map (what is filterable, how it maps).
- **validate** — in `collectListFilters`: request-only checks. Today only
  "present-but-empty value → 400"; values are otherwise opaque strings.
- **translate** — in the repository: a field definition → a parameterized
  predicate (`op: 'eq'` → `col->>'key' = $n`).

_Why:_ when the schema lands, value validation (enum/type) and possibly the
field set itself become schema-derived — that enriches `define` and fills
`validate` without touching `translate` or the route. Fusing value-checking into
the predicate builder would make schema integration a rewrite. _Trade-off:_ a
hair more structure than a one-off `publication_type` branch needs today; the
payoff is the schema slotting in cleanly and filter #3 being a declaration.

### Lenient now, provisional by intent

Unknown query params are ignored; unknown filter values yield an empty `200`.
Both are recorded in the spec as provisional, to tighten when the schema arrives
(unknown param → `400` from the schema's field set; out-of-enum value → `400`
from the schema's enum). _Why:_ while the param surface is still growing
(pagination, sort, sparse fieldsets are deferred), a strict gate produces false
`400`s on valid new params; leniency degrades gracefully. The cost — silently
ignoring a typo'd param/value — is accepted for now and explicitly scheduled for
correction. This mirrors the precedent and keeps the later tightening a planned
step, not a breaking surprise.

## Risks / Trade-offs

- **Unindexed JSONB filter → sequential scan** → correctness ships here; the
  `((reference->>'publicationType'))` expression index is the named
  `pbdb2-migrations` follow-up. Mitigation: small data today; index before the
  refs table grows.
- **Silent typo on a lenient param/value** (`?publicaton_type=book` → all refs)
  → accepted and documented as provisional; the schema-driven strict mode is the
  scheduled fix. Mitigation: the deferred follow-ups are written into the spec,
  not left implicit.
- **Unifying `list`/`readHeads` touches shipped read paths** → the existing
  `ids` and list behaviors are covered by tests; the unified method must keep
  them green (bare list = `HEAD_FILTER` only; `ids` alone = today's query).
  Mitigation: treat the existing suite as the regression contract.
- **Over-structuring for one filter** → the three stages are thin (a data map, a
  validate hook, a translate switch on `op`); the seam was explicitly built to be
  extended, and the proposal anticipates more filters. If that proved false the
  stages are still small functions, not a framework.
