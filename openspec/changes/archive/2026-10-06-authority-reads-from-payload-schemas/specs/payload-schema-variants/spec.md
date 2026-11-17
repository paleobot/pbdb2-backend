## ADDED Requirements

### Requirement: Link properties are declared with the `link` helper
`payloadSchemas/lib/links.js` SHALL export `link({ target, label })`, returning the schema of a property
whose value is a link to another resource:

| key | value |
|---|---|
| `type` | `"object"` |
| `properties.permid` | `{ type: "string" }`: the linked resource's permid, the only writable key |
| `properties[label]` | `{ type: "string", readOnly: true }`: the linked resource's `label` field |
| `properties.href` | `{ type: "string", readOnly: true }`: the linked resource's read URL, added by the API |
| `required` | `["permid"]` |
| `additionalProperties` | `false` |
| `x-link` | `{ target, label }` |

`target` SHALL be the linked resource's route-group name (for example `references`), and `label` the name of
a field of that resource (for example `title`). The label is not required: a target may lack it.

A link object's fields SHALL use the target's own names: `permid` is the target's id and `label` names one of
the target's fields. That keeps a later include of the whole target additive
(`api/docs/response-contracts.md` §4).

The storage layer SHALL NOT build or read `href`. It is declared so that `out` describes the response the
API sends.

#### Scenario: Helper output
- **WHEN** `link({ target: "references", label: "title" })` is called
- **THEN** it returns an object schema with `permid` (required), read-only `title` and read-only `href`, no other properties allowed, and `x-link: { target: "references", label: "title" }`

#### Scenario: Unknown key in a link object
- **WHEN** an authority response's `reference` carries `{ permid, title, href, authors }` and is validated against `out`
- **THEN** validation fails on `authors`

#### Scenario: Label may be absent
- **WHEN** an authority's merged `reference` is `{ permid }`, because the reference has no title
- **THEN** it is valid against `out`

### Requirement: `storageColumns` lists a source's column-backed properties
`storageColumns(source)` in `payloadSchemas/lib/storage.js` SHALL return the distinct column names that the
source's `x-storage` annotations name with `column`, at any depth reached through nested `properties`.
A caller reading stored rows SHALL be able to select exactly the columns that `merge` needs from it.
Annotations naming a child `table` SHALL contribute nothing.

#### Scenario: Authority columns
- **WHEN** `storageColumns(authoritySource)` is called
- **THEN** it returns `permid` and `reference_id`

#### Scenario: Child tables are not columns
- **WHEN** `storageColumns(collectionSource)` is called
- **THEN** it includes `permid` and `location`, and no `additional_collection_refs`

## MODIFIED Requirements

### Requirement: Annotation vocabulary
Sources SHALL use these annotations:
- `x-enumFrom`: defined by the payload-schema-enums capability.
- `x-storage` on a property: the property is not stored in the entity's jsonb. Its value is `{ column: <name> }`, `{ column: <name>, codec: <name> }`, or `{ table: <name>, codec: <name> }`.
- `readOnly: true` (standard JSON Schema) on a property: the value is supplied by the server and accepted in no input. `readOnly` MAY appear at any depth. A property is server-supplied when the server assigns it (`permid`, `legacyIDs`, person `totalHours`) or when it is resolved from another resource (a link's label and `href`).
- `x-link: { target, label }` on a property: the value is a link to a resource of route group `target`, embedding that resource's `label` field. It SHALL be declared only through the `link` helper.
- `x-create` on an object schema: a subschema applied at that node only in the `in-create` variant.

`readOnly` and `x-storage` SHALL be independent. For the collection and specimen sources:
- `permid` SHALL carry both.
- `legacyIDs` SHALL carry `readOnly` only.
- collection `location.coordinates.latitude` and `longitude` SHALL carry `x-storage: { column: "location", codec: "wgs84Point" }`.
- collection `references` SHALL carry `x-storage: { table: "additional_collection_refs", codec: "referenceList" }`.

For the person source:
- `permid` SHALL carry both, as on the other two.
- `legacyIDs` SHALL carry `readOnly` only.
- `totalHours` SHALL carry `readOnly` and `x-storage: { column: "total_hours" }`.
- `role` SHALL carry `x-storage: { column: "role_id", codec: "roleName" }` and no `readOnly`.
- `authorizer` SHALL carry `x-storage: { column: "authorizer_person_id", codec: "personPermid" }` and no `readOnly`.
- `active` SHALL carry `x-storage: { column: "active" }` and no `readOnly`.

For the authority source:
- `permid` SHALL carry both.
- `legacyIDs` SHALL carry `readOnly` only.
- `reference` SHALL be a link property (`x-link: { target: "references", label: "title" }`) carrying `x-storage: { column: "reference_id", codec: "referencePermid" }` and no `readOnly` of its own. Its `title` and `href` are read-only.

For the schema source:
- `permid` SHALL carry both, as on collection and specimen.
- `legacyIDs` SHALL carry `readOnly` only.
- `references` SHALL carry `x-storage: { table: "additional_schema_refs", codec: "referenceList" }` and no `readOnly`.

For the character and state sources:
- `permid` SHALL carry both.
- `legacyIDs` SHALL carry `readOnly` only.
- state `quantitative` SHALL carry `x-storage: { column: "quantitative" }` and no `readOnly`.

`readOnly` marks a value the server supplies, not one only a privileged caller may set. `role`, `authorizer`
and `active` are settable by an authorized caller, and which callers those are is a route concern that JSON
Schema cannot express; marking them `readOnly` would make them unsettable by anyone, because `in-create`
removes them and `patch-guard` rejects them. The person source SHALL define no `password` property and no
`createdAt` property.

#### Scenario: Read-only yet stored in jsonb
- **WHEN** the collection source is inspected at `legacyIDs`
- **THEN** it has `readOnly: true` and no `x-storage`

#### Scenario: Stored elsewhere yet writable
- **WHEN** the collection source is inspected at `location.coordinates.latitude`
- **THEN** it has `x-storage` naming the `location` column and the `wgs84Point` codec, and no `readOnly`

#### Scenario: Nested read-only accepted
- **WHEN** the authority source marks `reference.title` and `reference.href` as `readOnly`
- **THEN** every variant derives without error

#### Scenario: A link is writable while its label is not
- **WHEN** the authority source is inspected at `reference`
- **THEN** `reference` carries `x-link` and `x-storage` and no `readOnly`, and `reference.title` and `reference.href` carry `readOnly`

#### Scenario: Privileged but writable
- **WHEN** the person source is inspected at `role`, `authorizer` and `active`
- **THEN** none of them carries `readOnly`, and each carries `x-storage`

#### Scenario: Person read-only set
- **WHEN** the person `patch-guard` variant is derived
- **THEN** its `propertyNames.not.enum` is exactly `permid`, `legacyIDs` and `totalHours`

#### Scenario: Credentials are not a payload field
- **WHEN** the person source is inspected
- **THEN** it defines no `password` property, because credentials are handled by a separate flow, and no `createdAt` property, matching collection and specimen

### Requirement: The `in-create` variant enforces create-time completeness
The `in-create` variant SHALL:
- remove every `readOnly` property, at any depth, and remove its name from the `required` list of the node that declared it;
- keep `x-storage` properties;
- keep base `required` lists;
- merge each node's `x-create` into that node as an `allOf` entry.

For the collection source, `x-create` SHALL:
- at the root, require `context` and `references`;
- at `location.coordinates`, require `latitude` and `longitude`;
- at `ages.measurements[]`, require `error` and `method`;
- at `location.toponym.administrativeArea`, carry `if: { required: ["admin0"], properties: { admin0: { enum: ["US","CN","RU","AU","CA"] } } }, then: { required: ["admin1"] }`.

#### Scenario: Read-only field rejected on create
- **WHEN** a create payload includes `permid` or `legacyIDs`
- **THEN** validation fails on the unevaluated property

#### Scenario: A link's label rejected on create
- **WHEN** an authority create body carries `reference: { permid: "<p>", title: "x" }`
- **THEN** validation fails on `/reference/title`, and `reference: { permid: "<p>" }` passes

#### Scenario: admin1 required for listed countries
- **WHEN** a create payload has `location.toponym.administrativeArea: { admin0: "CA" }`
- **THEN** validation fails requiring `admin1`

#### Scenario: admin1 optional elsewhere
- **WHEN** a create payload has `location.toponym.administrativeArea: { admin0: "FR" }` and is otherwise complete
- **THEN** validation passes

### Requirement: The `patch-guard` variant screens a JSON Merge Patch body
The `patch-guard` variant SHALL be exactly `{ $id, type: "object", propertyNames: { not: { enum: [<names of the source's root readOnly properties>] } } }`. When the source has no root `readOnly` properties, `propertyNames` SHALL be omitted. Nested `readOnly` properties are not named in the guard. How a PATCH that touches one is rejected is a write-path decision outside this change: the merged-document check can't catch it, because step 3 would remove the field first.

PATCH follows merge-then-validate (`payloadSchemas/DESIGN_NOTES.md`):
1. the stored parts are `merge`d into a full document;
2. the patch is applied to it;
3. `readOnly` properties are removed;
4. the result is validated as a whole document;
5. it is `split` for writing.

Which variant validates the merged document is an API policy decision outside this change. No variant validates a patch body field by field.

The guard is needed because step 3 would otherwise silently hide a patch that tries to change a root `readOnly` property.

#### Scenario: Ordinary patch passes the guard
- **WHEN** the patch `{ "location": { "scale": "outcrop" }, "akaName": null }` is checked against the collection `patch-guard`
- **THEN** validation passes

#### Scenario: Read-only key rejected
- **WHEN** the patch `{ "legacyIDs": { "oldpbdbID": "1" } }` or `{ "permid": "…" }` is checked
- **THEN** validation fails naming the property

#### Scenario: Non-object body rejected
- **WHEN** the patch body is `[]` or `"x"`
- **THEN** validation fails

#### Scenario: Stored-elsewhere fields are patchable
- **WHEN** the patch `{ "location": { "coordinates": { "latitude": 10, "longitude": 20 } } }` is checked
- **THEN** validation passes

#### Scenario: Nested read-only is not a guard concern
- **WHEN** the authority `patch-guard` variant is derived
- **THEN** its `propertyNames.not.enum` is exactly `permid` and `legacyIDs`

### Requirement: The `out` variant describes a full response
The `out` variant SHALL:
- keep all properties, including `x-storage` and `readOnly` ones;
- keep base `required` lists;
- drop every `x-create`;
- remove `enum` from every schema that carries `x-enumFrom`, keeping the `x-enumFrom` annotation;
- keep inline enums;
- allow `null` for every property carrying `x-link`, meaning the linked resource has been removed. No other variant allows it.

#### Scenario: Dictionary value removed after storage
- **WHEN** a stored collection holds a `lithology` value that is no longer in `dictionaries.lithologies`, and its merged response is validated against `out`
- **THEN** validation passes

#### Scenario: Column-backed fields present
- **WHEN** the collection `out` variant is derived
- **THEN** it defines `permid`, `references`, `latitude`, and `longitude`

#### Scenario: A removed link target
- **WHEN** an authority response has `reference: null`
- **THEN** it is valid against `out`, and a create body with `reference: null` is invalid against `in-create`

### Requirement: Split and merge are driven by `x-storage`
`split(source, payload, ctx)` SHALL return `{ jsonb, columns, children }`:
- `jsonb` is the payload with every `x-storage` property removed;
- `columns` maps column names to storage values;
- `children` maps child table names to arrays of rows.

`merge(source, { jsonb, columns, children }, ctx)` SHALL be its inverse. A property with `x-storage.column`
and no codec SHALL map one-to-one to that column. A codec SHALL receive all sibling properties that name it
and produce one storage value or one set of child rows, and SHALL provide the inverse for `merge`. `ctx` is
the codec context defined below; it SHALL be optional, and a codec that declares no sources SHALL ignore it.
A codec serving a single property that carries `x-link` SHALL receive that annotation as `storage.link`.

For any payload valid against `in-create`, the `jsonb` returned by `split` SHALL be valid against `db`. For
any stored row, `split(merge(row))` with root `readOnly` properties removed SHALL equal the row after codec
normalization. A codec SHALL ignore the nested read-only fields it emitted on merge, such as a link's label.

#### Scenario: Split yields valid jsonb
- **WHEN** a payload valid against the collection `in-create` variant is split
- **THEN** the returned `jsonb` validates against the collection `db` variant

#### Scenario: Unknown codec
- **WHEN** a source names a codec absent from the registry
- **THEN** `split` and `merge` throw naming the codec

#### Scenario: Context-free codecs are unaffected
- **WHEN** a collection payload is split and merged with no `ctx` argument
- **THEN** `wgs84Point` and `referenceList` behave exactly as before

#### Scenario: Authority round trip ignores the label
- **WHEN** a stored authority is merged (yielding `reference: { permid, title }`), its root read-only properties are removed, and the result is split
- **THEN** `columns.reference_id` equals the stored value

### Requirement: A codec declares the lookup sources it needs
A codec that cannot be computed from the payload alone SHALL declare a `sources` array. Each entry SHALL be
`{ table: <qualified name>, key: <column>, value: <column> }`, naming a table to read and the two columns
that form the mapping. It MAY carry `versioned: true` to declare that the table holds a succession lineage,
and `payload: <column>` to name the table's jsonb column, from which link labels are read.
`x-storage` SHALL NOT carry the lookup's table or columns: the annotation keeps the three forms the annotation
vocabulary defines, and the codec is what knows its own source.

`collectCodecSources(source)` SHALL walk the source's `x-storage` codecs and return the union of their
declared sources, with duplicates removed. For a property that also carries `x-link`, the returned source
SHALL carry `labels` listing that link's `label`. Duplicates SHALL be identified by `table`, `key` and
`value`, and their `labels` lists SHALL be merged. A source carrying `labels` SHALL declare `payload`.

`codecKeyColumns(source)` SHALL return, per looked-up table, the `x-storage` columns whose values are that
source's keys, so that a caller reading rows in batches can build its selection by following the annotations
rather than by naming the columns itself. A codec whose `x-storage` names a child table rather than a column
contributes nothing, and a caller SHALL read such a source in full rather than per batch.

When a property carries both `x-enumFrom` and a codec declaring a source in the `dictionaries` schema, the
two SHALL name the same table. Source validation SHALL throw naming the property when they do not, because
the accepted values and the stored key would otherwise be free to drift apart.

#### Scenario: Sources collected from the source schema
- **WHEN** `collectCodecSources(personSource)` is called
- **THEN** it returns the `dictionaries.roles` and `persons` entries declared by `roleName` and `personPermid`, each once

#### Scenario: A link asks for its label
- **WHEN** `collectCodecSources(authoritySource)` is called
- **THEN** it returns one `refs` source carrying `payload: "reference"` and `labels: ["title"]`

#### Scenario: Annotation carries no lookup detail
- **WHEN** the person source is inspected at `role`
- **THEN** its `x-storage` is exactly `{ column: "role_id", codec: "roleName" }`

#### Scenario: Enum and codec disagree
- **WHEN** a property carries `x-enumFrom: { table: "genders", column: "name" }` and a codec declaring `dictionaries.roles`
- **THEN** source validation throws naming that property

#### Scenario: A child-table codec offers no key columns
- **WHEN** `codecKeyColumns(collectionSource)` is called
- **THEN** it returns no entry for `refs`, because `referenceList` is annotated `{ table, codec }` and the refs a batch cites live both in `collections.reference_id` and in the child rows

### Requirement: The codec context is loaded per selection and applied purely
`loadCodecContext(pg, sources, selection, reuse)` SHALL return a `Map` from each source's table name to
`{ byKey, byValue }` lookup maps, both populated from one read per source. The same read SHALL also populate:
- `labels`, a `Map` from key to `{ <label>: <value> }`, when the source carries `labels`. Each label is read as `"<payload>"->>'<label>'` and left out when NULL;
- `removed`, a `Set` of the keys whose rows are soft-removed, when the source is `versioned`.

A source declaring `versioned: true` SHALL be read with its superseded rows excluded, so that both `byKey` and
`byValue` are built from lineage heads only. On such a table many rows share one permid and `value → key` is
not a function; only the head restriction makes it one. Excluding superseded rows from `byKey` as well is
deliberate: foreign keys into a versioned table always denote the head, so nothing is lost, and a stored id
that does not resolve is a violated invariant that SHALL surface as a throw rather than resolve quietly.
Soft-removed heads SHALL NOT be excluded: they stay in `byKey` and `byValue` and are listed in `removed`, so
that a codec ignoring `removed` resolves exactly as before, and a codec that cares decides what a removed
target means.

`reuse` SHALL be an already-loaded context that seeds the result, and a source whose table it already holds
SHALL NOT be read again. Each call SHALL return a new `Map`, so that one batch's selection never accumulates
into the next one's.

`selection` SHALL name, per source, the column being restricted on and the values to restrict to, so that the
table is read by `WHERE <column> = ANY($1)` rather than in full. The restriction SHALL be expressible in
either direction: on the source's `key` column, which is what `merge` needs when it starts from a stored
column, and on its `value` column, which is what `split` needs when it starts from a payload — resolving a
permid to a `refs.id`, for instance, restricts on `permid`. A source omitted from `selection` SHALL be read
in full.

A source whose table is in the `dictionaries` schema SHALL be read once per run, in full, and SHALL NOT be
restricted per batch: these are curated vocabularies, and `dictionaries.roles` holds six rows. For every other
source the caller SHALL decide: one it can build a selection for SHALL be restricted per batch, so that
iterating a large table never loads more of a looked-up table than the batch references; one it cannot SHALL
be pre-loaded once for the run. Size is not the criterion — a lookup table is what is loaded, and it is
routinely far smaller than the number of rows citing it.

`split` and `merge` SHALL perform no I/O. A caller SHALL be able to supply a hand-built `Map` in place of a
loaded one, so that codecs are testable without a database, as `applyEnums` already is.

A codec SHALL throw, naming the codec and the unresolved value, when the context lacks a mapping it needs.

#### Scenario: Selection restricts an entity source
- **WHEN** the audit resolves a batch of 5,000 rows against the `persons` source
- **THEN** one query reads only the `persons` ids appearing in that batch

#### Scenario: Restriction in the value direction
- **WHEN** a caller is about to `split` payloads naming references by permid
- **THEN** it may select on the source's `value` column, and `refs` is read by `WHERE permid = ANY($1)`

#### Scenario: One read serves both directions
- **WHEN** a batch is merged and then split back
- **THEN** no second query is issued for the return direction, because the read that populated `byKey` populated `byValue`

#### Scenario: Dictionary source is not batched
- **WHEN** an audit of 275,554 collections runs in 5,000-row batches against a source in `dictionaries`
- **THEN** that source is read once for the run and passed to each batch as `reuse`, not read once per batch

#### Scenario: Versioned source resolves to the head
- **WHEN** a permid is held by both a superseded ref and its head
- **THEN** the context maps that permid to the head's `id`, and the superseded row appears in neither map

#### Scenario: Unversioned source is not filtered
- **WHEN** a source does not declare `versioned`
- **THEN** no succession filter is applied, and a source such as `persons` resolves by its `UNIQUE` permid alone

#### Scenario: Labels loaded with the keys
- **WHEN** the authority sources are loaded for a page citing two refs, one with a title and one without
- **THEN** one query reads both rows, `labels` holds `{ title }` for the first and `{}` for the second

#### Scenario: A removed head is marked, not dropped
- **WHEN** the head ref at `id = 7` is soft-removed and the `refs` source is loaded
- **THEN** `byKey` still maps `7` to its permid, and `removed` contains `7`

#### Scenario: Selection columns follow the annotations
- **WHEN** `codecKeyColumns(personSource)` is called
- **THEN** it maps `dictionaries.roles` to `role_id` and `persons` to `authorizer_person_id`, the columns `x-storage` names for the two codecs

#### Scenario: Tests resolve from fixtures
- **WHEN** a test calls `split(personSource, payload, fixtureContext)` with no database connection
- **THEN** it returns the same result a loaded context would produce

#### Scenario: Missing mapping
- **WHEN** `merge` is given a `role_id` absent from the context
- **THEN** it throws naming `roleName` and that id

#### Scenario: Context absent entirely
- **WHEN** `split` is called on a source whose codecs declare sources and no `ctx` is given
- **THEN** it throws rather than silently dropping the property

### Requirement: A shared ajv factory registers the annotations
`createAjv()` SHALL return an ajv instance for draft 2019-09 with `allErrors: true` and `strict: true`, except `strictRequired: false`. `x-create` merges as an `allOf` entry whose `required` names properties defined on the parent node, which that check rejects. `x-enumFrom`, `x-storage`, `x-create`, `x-link`, and `x-variant` (the root marker `deriveVariant` sets) SHALL be registered as annotation keywords, so that every variant compiles in strict mode. The converted migrations, the audit and the API's contract tests SHALL obtain their validators from `createAjv()`.

#### Scenario: Strict compile succeeds
- **WHEN** each variant of each converted entity is resolved and compiled with `createAjv()`
- **THEN** compilation succeeds without unknown-keyword errors

### Requirement: The authority source
`authoritySource` SHALL declare exactly these root properties:

| property | schema | annotations |
|---|---|---|
| `permid` | string | `readOnly`, `x-storage: { column: "permid" }` |
| `legacyIDs` | object with `oldpbdbIDs`: array of strings | `readOnly` |
| `reference` | `link({ target: "references", label: "title" })`: `{ permid, title, href }` | `x-storage: { column: "reference_id", codec: "referencePermid" }` |
| `citation` | string | |
| `descriptors` | array of strings | |
| `year` | string, `maxLength: 4` | |
| `publishedInReference` | boolean | |

Base `required` SHALL be `citation`, `publishedInReference` and `reference`. Because `reference` is an
`x-storage` property, the `db` variant SHALL neither declare nor require it, and SHALL require only `citation`
and `publishedInReference`, as the legacy schema did.

`x-create` SHALL constrain `year`, when present, to `pattern: "^[0-9]{4}$"`, declared with `type: "string"` so
that the `in-create` variant compiles in strict mode. `year` SHALL NOT be required on create. The `db` variant
SHALL carry no pattern on `year`: the 1,299 migrated scenario ④ authorities store `year: "0"` and 898 store
none, and both are legitimate history.

`citation` SHALL carry no constraint on its value. The scenario ④ sentinel `"authority unknown"` SHALL be
valid in every variant.

Every jsonb key SHALL keep the name and shape the authorities migration writes. `legacyIDs.oldpbdbIDs` stays a
plural array, because dedup merges several `taxon_no`s into one authority.

`authorizer_person_id` and `enterer_person_id` SHALL NOT be exposed as payload fields.

#### Scenario: Stored payload validates at rest
- **WHEN** `{ legacyIDs: { oldpbdbIDs: ["478544", "478546"] }, citation: "Brazidec and Perrichot 2022", descriptors: ["Brazidec", "Perrichot"], year: "2022", publishedInReference: true }` is validated against `db`
- **THEN** it passes, with no `reference` and no `permid` present

#### Scenario: Sentinel payload validates at rest
- **WHEN** `{ legacyIDs: { oldpbdbIDs: ["12"] }, citation: "authority unknown", descriptors: [], year: "0", publishedInReference: false }` is validated against `db`
- **THEN** it passes

#### Scenario: Legacy requirements carried over
- **WHEN** a payload omitting `citation`, or omitting `publishedInReference`, or with `year: "19690"`, or with an undeclared key, is validated against `db`
- **THEN** it fails

#### Scenario: Reference required on create
- **WHEN** a create body with `citation` and `publishedInReference` but no `reference` is validated against `in-create`
- **THEN** it fails naming `reference`

#### Scenario: Reference is a link object on create
- **WHEN** create bodies otherwise valid carry `reference: "<permid>"`, `reference: {}` and `reference: { permid: "<permid>" }`
- **THEN** `in-create` rejects the first two and accepts the third

#### Scenario: Four-digit year on create
- **WHEN** create bodies otherwise valid carry `year: "0"`, `year: "abc"` and `year: "1969"`
- **THEN** `in-create` rejects the first two and accepts the third

#### Scenario: Year optional on create
- **WHEN** a create body `{ reference: { permid }, citation: "authority unknown", descriptors: [], publishedInReference: false }` omits `year`
- **THEN** `in-create` accepts it

#### Scenario: Patch guard blocks the read-only fields
- **WHEN** the `patch-guard` variant is derived
- **THEN** it rejects exactly `permid` and `legacyIDs` as keys

### Requirement: `referencePermid` codec
The `referencePermid` codec SHALL declare the source
`{ table: "refs", key: "id", value: "permid", versioned: true, payload: "reference" }`, the same source
`referenceList` declares.

On merge it SHALL map the column `x-storage` names to the `reference` link object:
- a NULL column SHALL emit no property;
- an id listed in the context's `removed` SHALL emit `reference: null`;
- any other id SHALL emit `{ permid }`, plus the label `storage.link` names when the context's `labels` holds one for that id.

On split it SHALL read `reference.permid`, ignore every other key of the link object, and map the permid to
that reference's head `id` in the column `x-storage` names. An absent or `null` `reference` SHALL emit no
column. A permid whose head is removed SHALL throw, because nothing may cite a removed reference.

Ids SHALL be keyed as strings, as in `referenceList`, because `refs.id` is a bigint that node-postgres
returns as a string.

An unresolvable permid on split, or an unresolvable id on merge, SHALL throw naming `referencePermid` and the
value. With `authorities.reference_id` a NOT NULL foreign key that the swing trigger keeps on the head, an
unresolvable id is an integrity failure, not a data state.

Because the codec is annotated with a `column`, `codecKeyColumns` SHALL map `refs` to that column for a source
using it, so that a batched caller can select `refs` by the ids its rows hold.

#### Scenario: Permid to id
- **WHEN** an authority payload names `reference: { permid }` whose permid belongs to the head ref at `refs.id = 7`
- **THEN** `columns.reference_id` is `"7"`

#### Scenario: Id to link object
- **WHEN** a stored authority has `reference_id = 7`, and that ref's title is "Fossil leaves"
- **THEN** the merged payload's `reference` is `{ permid: <that ref's permid>, title: "Fossil leaves" }`, and no `refs.id` appears in the payload

#### Scenario: Untitled reference
- **WHEN** the ref at `id = 7` has no title
- **THEN** the merged `reference` is `{ permid }` with no `title` key

#### Scenario: Removed reference
- **WHEN** the head ref at `id = 7` is soft-removed
- **THEN** the merged `reference` is `null`, and splitting a payload naming its permid throws naming `referencePermid`

#### Scenario: Label ignored on split
- **WHEN** a merged `reference: { permid, title }` is split
- **THEN** only `columns.reference_id` is emitted, and `title` reaches neither the jsonb nor any column

#### Scenario: Superseded reference resolves to the head
- **WHEN** the ref at `id = 7` is superseded by a new version sharing its permid
- **THEN** splitting a payload naming that permid yields the new head's `id`, not `7`

#### Scenario: Unknown reference permid
- **WHEN** a payload names a `reference` permid held by no reference
- **THEN** `split` throws naming `referencePermid` and that permid

#### Scenario: Key column for batched selection
- **WHEN** `codecKeyColumns(authoritySource)` is called
- **THEN** it maps `refs` to `reference_id`
