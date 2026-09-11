## Context

`docs/taxa-classification-reads.md` records the measurements behind this change
and deliberately excludes the decisions, forward-referencing "that change's
`design.md`" — this file. That file was written 2026-09-10; this one was not
created at the time, because the session that produced the measurements pivoted
into proposing `add-pagination` and `generalize-fk-enrichment` instead. Several
decisions from that session therefore had nowhere to land and were lost. Two were
recovered from the author's memory on 2026-09-11 (the read-only factory shape and
the 405 response); the rest were re-derived, and where re-derivation produced new
evidence it is recorded here rather than in the measurements doc.

That is the reason this file is heavier on rationale than the change's size
warrants. The measurements doc is the evidence; this is the verdict.

Prerequisites, both landed:

- `add-pagination` — keyset cursor over `permid`; taxa inherits it unchanged.
- `generalize-fk-enrichment` — `LINK_TARGETS`, permid-keyed links,
  `linkProjections()`. Taxa is its first real consumer, and consuming it exposed
  one gap (see below).

## Goals / Non-Goals

**Goals:**

- `GET /taxa` and `GET /taxa/{permid}` returning the representation settled in
  `docs/taxa-classification-reads.md` §7.
- A read path that works without a JSONB payload or a version chain, without
  weakening the generic one.
- A read-only resource shape that is a first-class option in the route factory,
  since more derived tables (`taxa_linnaean`, `taxa_clades`) will want it.
- The containing-taxa chain, with the list/single asymmetry the measurements
  argue for.
- Close every decision this change touches *in writing*, including the ones
  whose answer is "no".

**Non-Goals:**

- Any write path, for taxa or for opinions.
- Name ordering, field filters, descendant reads, or ancestor search.
- Reworking the generic repository to accommodate taxa. Taxa gets its own read
  module; the generic engine stays aimed at version-chained JSONB resources.

## Decisions

### `taxa` gets its own repository, not a generalized one

`HEAD_FILTER` is `succeeded_by_id IS NULL AND NOT COALESCE(removed, false)` and
the generic select is `SELECT permid, <jsonbColumn> AS payload`. Taxa has neither
column. Making the generic engine handle both shapes means a conditional in every
one of its query builders, to serve one resource.

_Decision:_ a separate `src/lib/taxa-repository.js`, following the `schema-tree.js`
precedent. It **reuses** the exported `linkProjections()` — that function is
parameterized by a qualifier precisely so a non-generic caller can use it, which
the schema tree already does with a CTE alias.

_Note the asymmetry with `schemas`:_ `schemas` opted out of the shared factory
because its *read* is an aggregate. Taxa opts out because its *table shape* and
its *write surface* are both different. They are not the same exception.

### Read-only is a shape in the route factory; write verbs are 405

Taxa has no write path and never will — `derive_taxa()` owns the table. The
options were to omit the write routes (yielding 404, which says "no such
resource" about a resource that plainly exists), to stub them like the other
groups (which advertises a write path that cannot exist), or to answer 405.

_Decision:_ **405 Method Not Allowed**, with an `Allow: GET` header, expressed as
a read-only option in `registerCrudRoutes` rather than hand-written in the taxa
route file. 405 is the accurate status: the resource exists, the method does not
apply to it. The `Allow` header is what makes it discoverable rather than merely
a refusal.

_Why in the factory:_ `taxa_linnaean` and `taxa_clades` are the same shape and
are plausible future resources. A second hand-written read-only route file is the
point at which this would get extracted anyway; doing it now costs an options
flag.

_This decision was made in the 2026-09-10 session and lost._ It is recorded here
in full, including the rejected alternatives, so it does not have to be made a
third time.

### The containing-taxa chain is read from `classification_path`, behind one function

Measured (`docs/taxa-classification-reads.md` §4–§5): the path agrees with the
`containing_concept_permid` adjacency chain across all 517,226 rows, with zero
disagreement. The recursive CTE is ~2× faster on a single deep read; the page
case is a wash. Performance does not decide it.

_Decision:_ use `classification_path`, with the decoding isolated behind a single
function. It wins on two grounds that survive the performance tie: the path is
**already on the row you fetched**, so depth, breadcrumbs, and ancestor-of tests
cost no extra query; and deduplication across a page falls out naturally.

The isolation is the mitigation for the schema's §9.7.4 reservation — the backend
explicitly reserves the right to reshape or drop `classification_path` as a cache
change. Confining path decoding to one function makes that a one-file swap to the
documented recursive-CTE fallback.

_On the backend's own guidance:_ `create_new.sql` says ancestor/descendant
queries "should walk `containing_concept_permid` recursively instead, not rely on
an ltree containment index." That guidance is about **indexed search** over the
hierarchy, in the context of explaining why the GiST index was dropped (2589-char
values overflow an index page). Reading the column off a row already located by
`permid` uses no index and is not what that sentence addresses. The distinction
is recorded because re-deriving it is exactly what this file exists to prevent.

Two traps the decoder owns, both measured:

- ltree labels cannot contain `-`, so elements are permids with hyphens replaced
  by underscores. Round-trip with `replace(label, '_', '-')`; safe because UUIDs
  contain no underscores.
- The last element is the row's own **concept** permid, not its permid. Ancestors
  are elements `[0 .. n-2]`. For the 30.7% of rows where
  `concept_permid <> permid` the final element is not the row you asked for.

### No depth cap on the chain

Depth reaches 70 today, which is large because the rework merged Linnaean and
clade opinions into one tree (`taxa_linnaean` alone runs ~15–20).

_Decision:_ no cap. With the path approach the chain is not a traversal — the
path is a stored value already in hand, decoded in `O(depth)` string work and
resolved by one bounded `= ANY()` fetch. There is no recursion to run away and no
cycle to guard against (`derive_taxa()`'s cycle-breaking guarantees acyclicity).
A cap would be a pure presentation choice, and it would import a problem this
design does not otherwise have: signaling truncation. A client handed a silently
clipped chain is worse off than one handed 70 levels.

_Caveat for the fallback:_ the recursive-CTE fallback genuinely recurses, so an
iteration guard belongs to that implementation if the swap is ever made.

### The read does **not** filter `removed`

`taxa` has a `removed` column. Nothing maintains it. Verified in
`pbdb2-migrations/postgresql/create_new.sql`:

- `rebuild_taxa()`'s `INSERT` names twelve columns; `removed` is not among them.
- Its `ON CONFLICT DO UPDATE SET` names the same twelve; `removed` is not among
  them.
- Rows that stop being produced are **hard-deleted**:
  `DELETE FROM taxa t WHERE NOT EXISTS (SELECT 1 FROM _rebuild_taxa_src s WHERE
  s.permid = t.permid)`.

Confirmed live: zero rows have a non-null `removed`.

_Decision:_ do not apply a `removed` predicate. It would filter on a column whose
writer never sets it — not "not yet", but by construction, since soft deletion
contradicts the rebuild-and-delete model.

_This is not a hole in removal semantics._ Soft deletion is honored one layer
upstream: `derive_taxa()` reads the opinion tables through
`WHERE n.removed IS NOT TRUE AND n.succeeded_by_id IS NULL`. A taxon whose
supporting opinions are all removed simply stops being produced, and
`rebuild_taxa()` deletes its row. By the time a row is in `taxa` it has already
passed the filter the generic repository would have applied.

_Rejected alternative:_ keep the predicate defensively, in case someone hand-sets
the column. That defends against a state the system has no way to produce, at the
cost of encoding a false belief — that removal is soft here — into the one file a
future contributor will read to learn how taxa reads work.

### `LINK_TARGETS` gains a plain-column label

`linkProjections()` builds `json_build_object(<label>, r.<payloadColumn>-><label>,
'permid', r.permid)`. Every target so far has had a JSONB payload. `taxa.name` is
a column, so the projection needs to emit `r.name` instead.

_Decision:_ a link target declares its label as either a JSONB key within a
payload column or a plain column. Taxa registers with a plain-column label, which
is what makes `accepted` (self-referential, permid-keyed) resolvable.

_Why this was not caught by `generalize-fk-enrichment`:_ that change's own design
flagged "shipping unexercised generality" as a risk and mitigated it with
descriptor-level tests. The permid-keying it shipped is correct. But the test
validating it declares `{ table: 'taxa', payloadColumn: 'taxon', label: 'name' }`
— and `taxon` is not a column that exists. The payload assumption rode along
inside a fixture and was never examined. Worth remembering the next time
generality ships one step ahead of its consumer: the fixture will agree with
whatever the code assumes.

### Dictionary flattening is not a link

`rank_id` and `nomenclatural_status_id` are integer FKs into
`dictionaries.taxonomy_ranks` and `dictionaries.nomenclatural_statuses` — small,
static, non-`permid` tables that are not resources and have no routes.

_Decision:_ flatten them to their text values (`rank`, `nomenclaturalStatus`)
rather than modelling them as links. A link object carries `permid` and `href`;
dictionary entries have neither. `nomenclaturalStatus` is null for 98.4% of rows,
which is the correct rendering of "nomenclaturally valid".

_Implementation note:_ these tables live in the `dictionaries` PostgreSQL schema,
so their names are schema-qualified. `bareIdent()` in `repository.js` enforces
`/^[a-z_][a-z0-9_]*$/` and rejects the dot, which is a second reason dictionary
flattening cannot route through the link registry's identifier path even if the
label problem were solved.

_Rank renders as text only._ `dictionaries.taxonomy_ranks` also carries `height`
(species=20, genus=40, …, NULL for unranked), which would let a client compare
ranks without embedding a rank table. Not exposed: no consumer, and it is
additive whenever one appears.

### `accepted` is the only self-link

`taxa` carries three self-referential permid columns. Measured live:

| column | ≠ own permid | meaning |
| --- | --- | --- |
| `concept_permid` | 158,732 (30.7%) | senior synonym / taxonomic concept |
| `accepted_spelling_permid` | 117,139 (22.6%) | correct spelling in the lineage |
| `original_permid` | 117,139 (22.6%) | original spelling as published |

They are independent axes: `original_permid <> accepted_spelling_permid` on
195,141 rows.

_Decision:_ surface `concept_permid` as `accepted`, and only that. "Accepted" in
PBDB conflates synonymy with orthography; this picks the concept, which is what
nearly a third of rows point elsewhere on and what callers asking "what is this
taxon really called" mean. The other two are recorded here as real distinctions
with no consumer yet, so that adding them later is a decision rather than a
discovery.

### The chain is always on for single reads, opt-in for lists

Measured (§6) for a 100-item page of deep taxa: 3,930 ancestor entries serialized,
310 distinct among them, a 12.7× duplication factor, ~457 kB of JSON for the
chains alone before the taxa themselves.

_Decision:_ full nested chain on `GET /taxa/{permid}`, with no parameter to
suppress it. Omitted from list items unless `?includeContainingTaxa=true`.
Depth-70 nesting is defensible for a single object — it mirrors the data, there
is exactly one of it, and reaching a given rank is a client-side loop. On a list
it is half a megabyte of mostly-duplicate text most callers did not ask for.

_If breadcrumbs-on-lists turn out to be the common case_, the 12.7× figure is the
argument for a pooled shape — chains as permid references plus one shared
`included` map — not for making inline the default.

### The opt-in is a boolean, not a generic `?include=`

`?include=containingTaxa` is the conventional shape, and `?include=` does not
exist anywhere in this API today — it would be the first.

_Decision:_ `?includeContainingTaxa=true`. Shipping a generic mechanism for
exactly one value means designing, now, a per-resource vocabulary registry,
unknown-value behavior, multi-value syntax, and the interaction rules with `ids`
and pagination — a mechanism-sized surface for one boolean's worth of behavior.

The switching cost is what decides it: adding `?include=` later while keeping
`includeContainingTaxa` as an alias is easy and non-breaking, whereas freezing a
half-designed general mechanism into v1 is not. And `include` + `ContainingTaxa`
is mechanically derivable from the field name, so a second opt-in would arrive as
`?includeX=true` — a *pattern*, which is what generalizes cleanly into
`?include=x,y` once it has earned its keep.

The immediately preceding change is the cautionary case: generality shipped one
step ahead of its consumer, and the assumption riding alongside it went unnoticed
until the consumer arrived.

_Accepted values are exactly `true` and `false`._ Anything else is a 400 —
including a bare `?includeContainingTaxa` with no value, which is genuinely
ambiguous. This matches `limit`'s existing strictness.

_`?ids=` accepts the opt-in._ A multi-entity read is a list and gets list
semantics, so the chain is off by default. It is capped at `MAX_IDS` (100), which
makes it precisely the 457 kB case — but the client has explicitly asked, and the
shape is identical to a page. Stated rather than inherited, because `ids` already
carries bespoke rules (it rejects `limit`/`cursor`).

### `meta.removed` and `meta.version` stay on taxa responses

`sendData` injects `removed: false` and `version: { supersedes: null,
supersededBy: null }` into every single-resource response. Taxa has no version
chain, and its `removed` column is dead (see above), so the question arose during
implementation whether these should be omitted for a non-versioned resource.

_Decision:_ keep them, unchanged and uniform.

They are not inaccurate. A taxon genuinely has no predecessor and no successor,
and genuinely is not removed; the fields are trivially true rather than false.
The earlier framing of them as "asserting something untrue" was wrong.

The deciding argument is that uniformity here is operational, not aesthetic. A
generic client written as `if (res.meta.version.supersededBy) { … }` works
correctly against every resource, and taxa's answer — no successor — is the
operationally correct one. Omitting the fields would make that same client throw
on taxa (`meta.version` absent, so the dereference raises) and force it to know
which resources are versioned. Omission does not make clients safer; it makes
them special-case.

It is also what `api-foundation` already requires: "The envelope SHALL reserve
`meta.version` and `links` relationship entries even when their values are
placeholders." Keeping them needs no amendment; omitting them would need one.

_Reversibility, since this is the direction that is harder to undo:_ removing the
fields later is breaking for any client dereferencing `meta.version.*` on a
taxon — a throw, not an `undefined`. There are no clients yet, and a breaking
envelope revision has a designated home in a future `/api/v2`, so the exposure is
a version bump rather than a trap. Recorded because "we thought about this and
chose uniformity" is not recoverable from the code, which simply looks like
nothing happened.

_Note the contrast with the query-param decision above_, where the asymmetry ran
the other way: there, leniency silently produced wrong-looking-right answers and
tightening later would break working clients, so strictness belonged at v1. Here
the extra fields cost nothing and removing them would break correct clients. The
two decisions point opposite ways for the same reason — what the client can
safely assume.

### Unrecognized query parameters become a 400, on every resource

`resource-routes` currently requires lenient handling: "an unrecognized query
parameter SHALL be ignored", marked provisional pending JSON Schema integration.
Bad *values* are already strict — `limit`, `cursor` and `ids` all 400 on
malformed input. The gap is unrecognized *names*.

_Decision:_ reject unrecognized query parameters with a 400 naming them, on
single reads as well as lists.

The reason is specific to this API rather than general good practice: a silently
ignored parameter produces a result indistinguishable from a legitimate one.
`?includeContainingTax=true` returns a taxon with no chain, which reads exactly
like a taxon with no ancestors. `?publication_typ=journal article` returns the
unfiltered list, which reads exactly like everything matching. This is a
scientific database; a wrong answer that looks right is worse than an error.

That reasoning is already in the codebase — `list-filters.js` rejects an
oversized `limit` rather than clamping because a silent clamp "leaves a client
believing it has seen more of the result set than it has, which surfaces as
missing data much later." A misspelled filter is the same failure, and a
misspelled opt-in is a sharper version of it.

_Direction matters:_ loosening later is free, tightening later breaks working
clients. If strictness is ever right, it is right now, at v1, before there are
clients.

_No `_`-prefix escape hatch_ for pass-through parameters (cache-busting, tracking)
until something actually needs one; adding it later is non-breaking.

_Scope honesty:_ this is a cross-cutting amendment riding in a resource change,
of the kind that got split out twice before. It is included here because it is
~12 lines against one call site (`collectListFilters`), versus the much larger
surfaces pagination and enrichment presented — and because the taxa opt-in is the
parameter whose silent failure is most misleading. Named deliberately rather than
arriving as a footnote.

### Lists stay `permid`-ordered

`add-pagination` left the compound-cursor question to this change. Name ordering
is what a human would want; `permid` on a derived table is UUIDv7, i.e. rebuild
insertion order, which is arbitrary.

_Decision:_ keep `permid` ordering for now. Names are nearly unique — 511,479
distinct over 517,226 rows, 10,669 rows sharing a name, max 7 on one name — so a
name-ordered keyset is viable but **must** be compound `(name, permid)`; name
alone is not a key. The backend has `taxa_name_idx` on `name` alone and nothing
on `(name, permid)`, so a row-comparison keyset would be poorly supported and the
fix is a migration in `pbdb2-migrations`, not a change here.

The cursor token is opaque precisely so this can change without a client-visible
break. Recorded as a stated decision rather than a default inherited from the
seam.

## Risks / Trade-offs

- **[Strict query params is a behavioral break on every existing resource, shipped
  inside a change named for taxa]** → Mitigated by being additive to reject only
  what was previously *ignored* — no request that produced a correct answer starts
  failing. The delta is one requirement in `resource-routes`, replaced rather than
  amended, so the reversal is visible in the spec history.

- **[`classification_path` is explicitly reshapeable by the backend (§9.7.4)]** →
  The decoder is one function and the recursive CTE is the documented fallback,
  measured and ~2× faster on single reads. The exposure is a one-file swap, and
  the path/adjacency agreement is verified across all 517,226 rows so the fallback
  returns identical results.

- **[A second bespoke repository alongside `schema-tree.js`]** → Accepted. The
  generic engine stays aimed at version-chained JSONB resources rather than
  growing a conditional per exception. `linkProjections()` is shared, so link
  resolution does not fork — which is the part that would actually drift.

- **[Depth-70 nesting on every single read, uncapped]** → It mirrors the data and
  there is exactly one object per response. The list case, which is where depth
  multiplies into real bytes, is opt-in and measured.

- **[The read-only shape lands in the factory with one consumer]** → This is the
  same "generality ahead of its consumer" bet this design criticizes elsewhere.
  Distinguished by being a verb-surface flag rather than a data-shape assumption:
  its behavior is fully exercised by taxa's own 405 tests, with nothing riding
  along unexamined inside a fixture.

## Open Questions

- Whether `?include=` eventually replaces `includeContainingTaxa`. The trigger is
  a second opt-in expansion; until then the boolean is the whole mechanism.
- Whether a `(name, permid)` index in `pbdb2-migrations` is worth requesting, and
  whether name-ordered lists should be the default when it exists.
- Whether the opinion tables become resources, which is where taxonomy's write
  path, `winning_*_opinion_id` provenance, and any point-in-time reconstruction
  all live.
- Whether `original_permid` / `accepted_spelling_permid` ever surface, and under
  what names — "accepted" is already an overloaded word in this domain.
- Whether `taxa_linnaean` and `taxa_clades` become resources, which is the second
  consumer that would justify the read-only factory shape on its own.
