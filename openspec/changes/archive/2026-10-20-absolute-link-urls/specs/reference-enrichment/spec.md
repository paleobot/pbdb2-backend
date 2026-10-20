## MODIFIED Requirements

### Requirement: Suppression and href hydration apply to every link target

The soft-removal and HTTP-agnosticism rules established for references SHALL
apply to every link, however it is declared and whatever its target. A link whose
resolved target row is soft-removed SHALL yield `null` for a single-valued link
and SHALL be omitted from a multi-valued link's array. The persistence layer SHALL
emit only `{ <label>, permid }` for every link, and `href` SHALL be added at the
route/envelope boundary from data already filtered for soft-removal, so no `href`
can point at a suppressed resource. For a source link, the boundary SHALL find the
links by the source's root properties that carry `x-link` (adding `href` to the
value) or whose `items` carry it (adding `href` to each item of the array).

#### Scenario: A removed target is suppressed for any group

- **WHEN** a declared link's resolved target row is soft-removed, for any target
  route group
- **THEN** a single-valued link is `null`
- **AND** a multi-valued link omits that entry from its array

#### Scenario: The persistence layer emits no href for any link

- **WHEN** the read repository or the taxa repository produces any link object
- **THEN** it yields the label and `permid` without an `href`
- **AND** the `href` is added only at the route/envelope boundary

#### Scenario: Link items are hydrated

- **WHEN** a collection with two additional references is read
- **THEN** each `additionalReferences` item carries `href` equal to
  `<base>/api/v1/references/{permid}`, where `<base>` is the public base URL

### Requirement: Authority reads embed their reference

A read of an `authorities` resource (single or list item) SHALL include a
`reference` field resolved from the `authorities.reference_id` foreign key. It is
declared in the authority payload source as
`link({ target: "references", label: "title" })` and resolved by the
`referencePermid` codec. The value SHALL be an object `{ title, permid, href }`:
- `title` is the referenced `refs` row's `reference->>'title'`, and the key is left
  out when that is NULL;
- `permid` is that row's `permid`;
- `href` is `<base>/api/v1/references/{permid}`, where `<base>` is the public base URL.

When the referenced reference is soft-removed, `reference` SHALL be `null`.
Authorities SHALL declare no descriptor `links`.

#### Scenario: Authority single read includes its reference

- **WHEN** an authority with a live referenced `refs` row is read by `permid`
- **THEN** `data.reference` is `{ title, permid, href }`
- **AND** `title` is the referenced row's `reference->>'title'`
- **AND** `permid` is the referenced lineage's `permid`
- **AND** `href` is `<base>/api/v1/references/{permid}`

#### Scenario: Authority list items include their reference

- **WHEN** the authorities list is read
- **THEN** each item in `data` carries the same `reference` object shape

#### Scenario: Untitled reference

- **WHEN** an authority's referenced `refs` head has no `title`
- **THEN** `data.reference` is `{ permid, href }`, with no `title` key

#### Scenario: Removed authority reference is suppressed

- **WHEN** an authority's referenced `refs` head is soft-removed
- **THEN** `data.reference` is `null`

### Requirement: Enriched references are embedded in data with a navigable href

Enriched links SHALL be embedded as domain fields within `data` (not within the
envelope `links`), and each link object SHALL carry an `href` pointing at the
target lineage's read URL so the same object is navigable in both single reads
and list items. That URL SHALL be absolute: the public base URL
(`api-foundation`) followed by the target's path. For links targeting the
`references` group it is `<base>/api/v1/references/{permid}`. The `href` SHALL be
hydrated at the route/envelope boundary from the resolved `permid`; the
persistence layer SHALL emit only the label and `permid` and SHALL NOT construct
URLs. Hydration SHALL derive `href`
only from link objects already filtered for soft-removal, so no `href` can point
at a suppressed resource.

#### Scenario: Reference objects carry a resolvable href

- **WHEN** any enriched reference object is returned
- **THEN** it includes `href` equal to `<base>/api/v1/references/{permid}` for its
  `permid`

#### Scenario: Persistence layer is HTTP-agnostic

- **WHEN** the read repository produces a reference
- **THEN** it yields `{ title, permid }` without an `href`
- **AND** the `href` is added only at the route/envelope boundary
