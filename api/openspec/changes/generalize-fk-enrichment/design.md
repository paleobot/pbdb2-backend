## Context

`add-reference-enrichment` built relationship enrichment as the concrete instance
of a slot the scaffold had reserved. It got the hard parts right: enrichment is
declared as data on the descriptor, resolved in SQL as correlated sub-selects,
soft-removal is suppressed in the query (so no dangling `href` can form), and the
persistence layer stays HTTP-agnostic — it emits `{ title, permid }` and the
`href` is hydrated at the route boundary from the group's *mounted prefix*, never
a hard-coded literal.

What it did not do is parameterize the target. `refs`, `reference`, and `title`
are baked into `referenceProjections`; `referencesBase` appends the literal
`'references'`; the descriptor key is `references`. That was the right call for
one instance — the descriptor comment in `resource-tables.js` even names the
`references` field "the concrete instance of the once-deferred `relationships`
slot."

`taxa` is the second and third instances arriving together: `authority_id` →
`authorities` (label at `authority->>'citation'`), and `concept_permid` → `taxa`
itself, where the FK column already holds a permid rather than a serial id. This
change makes the target a parameter and nothing else.

## Goals / Non-Goals

**Goals:**

- A link target is declared, not hardcoded: any route group can be pointed at.
- Both foreign-key shapes are supported: serial-id columns (today's form) and
  permid-carrying columns.
- Zero observable change to any existing response.
- Keep every property the current design earned — data-declared config, SQL-side
  soft-removal suppression, prefix-derived hrefs, HTTP-agnostic persistence.

**Non-Goals:**

- Dictionary flattening (`rank_id` → `"genus"`). No `permid`, no route group, no
  `href` — a different mechanism that belongs to the taxa change.
- Adding any enrichment to any existing resource.
- Renaming the `reference-enrichment` capability (see Risks).
- Anything `taxa`-specific. This change ships no taxa descriptor.

## Decisions

### The target route-group name is the only identifier

A link declares `target: 'references' | 'authorities' | …` — a route-group name —
and a registry resolves that name to `{ table, payloadColumn, label }`:

```js
const LINK_TARGETS = {
  references:  { table: 'refs',        payloadColumn: 'reference', label: 'title' },
  authorities: { table: 'authorities', payloadColumn: 'authority', label: 'citation' },
};
```

_Why:_ the group name is already the thing `referencesBase` needs to build an
`href` (it joins the target group onto the citing group's parent prefix, so a
future `v2` adapts automatically). Reusing it as the registry key means the SQL
source and the URL base are selected by one identifier and cannot drift into
disagreement — a class of bug that a separate `hrefBase` field would invite.

_Alternative considered:_ inline the table/column/label on each link declaration,
with no registry. Rejected because `references` is declared by four resources
today; inlining would repeat the same three facts four times and make a change to
the label key a four-site edit.

### `on: 'id' | 'permid'` rather than two link kinds

A link declares how its column matches the target:

```
on: 'id'      →  WHERE <target>.id     = <citing>.<via>     (reference_id)
on: 'permid'  →  WHERE <target>.permid = <citing>.<via>     (concept_permid)
```

_Why a flag over separate declaration types:_ every other property of the link —
the label projection, the soft-removal suppression, the `{ label, permid, href }`
output shape, the hydration — is identical between the two. Only the join
predicate differs, so the difference is one axis of one declaration, not a second
code path.

_Why include `permid` keying in this change at all, given it has no consumer
until taxa:_ the whole change is deliberately ahead of its consumer — that is
what splitting it out means. Drawing the scope line at "everything the known
consumer needs, nothing more" is what keeps `add-taxa-reads` a descriptor
declaration instead of a fourth reopening of these same four files. It is
validated by a descriptor-level test rather than by an existing response, and the
proposal says so.

### The version-chain assumption differs by target, and the registry must not hide it

Reference resolution is sound without separate version resolution because the
backend's swing trigger keeps inbound FKs pointed at the current head. That holds
for `refs` and `authorities`, which are version-chained. It does **not** hold for
`taxa`, which has no version chain at all — but there it is moot, since `taxa` has
exactly one row per permid (`UNIQUE (permid)`).

_Decision:_ the projection does not emit a head filter for the target; it relies
on the target being either swung-to-head (versioned tables) or single-rowed
(`taxa`). This is already the current behavior, and it is recorded here because
the registry makes it easy to add a target for which neither holds. Any future
target that is version-chained *without* swung FKs would need an explicit head
filter, and the registry entry is where that would have to be declared.

### `reference-hydration.js` becomes `link-hydration.js`

The module is renamed along with its exports (`referencesBase` → `groupBase`,
`hydrateReferenceHrefs` → `hydrateLinkHrefs`), and hydration resolves each link's
base from its own target rather than taking one base for the whole record.

_Why rename rather than add alongside:_ leaving `reference-hydration.js`
exporting a generalized `groupBase` would leave the filename lying about its
contents, and the file's own doc comment is the place the reference-specific
reasoning currently lives. A rename keeps name and content honest; the change is
mechanical and fully covered by the existing test suite.

## Risks / Trade-offs

- **[A refactor with no behavior change is easy to get subtly wrong and hard to
  notice]** → The existing enrichment suites are the regression contract and must
  pass untouched. Any test that needs editing to go green is a signal that
  behavior moved, not that the test was stale — that is the review rule for this
  change.

- **[The capability ends this change broader than its name]** → Accepted
  deliberately. Renaming `reference-enrichment` → `relationship-enrichment` is
  spec-tree churn worth doing once the second real instance exists, which is
  `add-taxa-reads`. Renaming now would mean a capability named for a generality
  that still has exactly one instance.

- **[Shipping unexercised generality — permid-keyed links and the `authorities`
  registry entry have no production consumer in this change]** → This is inherent
  to splitting the change out, and the mitigation is that the consumer is known
  and imminent rather than hypothetical. Both are covered by descriptor-level
  tests so they are not merely unexecuted code.

- **[Four route files and two lib modules change at once]** → The edits are
  mechanical renames plus one new registry; the surface is wide but shallow, and
  no route file changes shape — they still pass a descriptor's config straight
  through.

## Open Questions

- Whether `LINK_TARGETS` should eventually be derived from the same source as the
  resource descriptors (a target is nearly a descriptor minus its filters). Left
  alone here: the overlap is two fields, and collapsing them would couple
  "resources this API serves" to "resources this API can link to", which are not
  guaranteed to stay the same set.
