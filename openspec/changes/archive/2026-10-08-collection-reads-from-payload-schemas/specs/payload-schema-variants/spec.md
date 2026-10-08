## ADDED Requirements

### Requirement: The collection source declares its stored references
The collection source SHALL describe a collection's references the way they are stored now. They SHALL NOT
be a `references[]` array with an `order`.

| property | schema | annotations |
|---|---|---|
| `primaryReference` | `link({ target: "references", label: "title" })`: `{ permid, title, href }` | `x-storage: { column: "reference_id", codec: "referencePermid" }` |
| `additionalReferences` | array whose `items` are `link({ target: "references", label: "title" })` | `x-storage: { table: "additional_collection_refs", codec: "referenceLinks" }` |

- `additionalReferences` SHALL be an unordered set. It SHALL declare no `order`, no `minItems` and no
  `uniqueItems`. Items are emitted in a stable order, but the contract promises none.
- `additionalReferences` SHALL hold every `additional_collection_refs` row of the collection. That
  includes a row citing the primary reference, which most collections have because Classic's
  `secondary_refs` lists the primary. The source SHALL NOT drop that row, and its comment SHALL say that
  the primary usually repeats.
- Neither property SHALL carry `readOnly`. Their labels and `href` are read-only through `link`.
- Root `x-create` SHALL require `primaryReference`. `additionalReferences` is optional on create.

The reference model is with a committee (`docs/api-design-backlog.md`, "Collection reference model"). If
order turns out to be wanted, or the primary leaves the child table, this requirement changes.

#### Scenario: Primary and additional references are links
- **WHEN** the collection source is inspected
- **THEN** `primaryReference` carries `x-link` and `x-storage` naming `reference_id` and `referencePermid`
- **AND** `additionalReferences.items` carries `x-link`, and `additionalReferences` carries `x-storage` naming `additional_collection_refs` and `referenceLinks`
- **AND** no `references` property is declared

#### Scenario: No order on an additional reference
- **WHEN** a create body carries `additionalReferences: [{ permid: "<p>", order: "2" }]`
- **THEN** validation against `in-create` fails on `order`

#### Scenario: The primary may repeat among the additional references
- **WHEN** a merged collection has `primaryReference.permid` equal to the `permid` of one `additionalReferences` item
- **THEN** it is valid against `out`

### Requirement: `referenceLinks` codec
The `referenceLinks` codec SHALL declare the source
`{ table: "refs", key: "id", value: "permid", versioned: true, payload: "reference" }`, the same one that
`referencePermid` and `referenceList` declare. It SHALL declare `keyColumn: "reference_id"`, the
child-row column that holds a `refs.id`.

It maps an unordered array of reference links, the property it serves (`storage.property`), to rows of the
child table its `x-storage` names. It writes no column on the parent. The foreign key from a child row back
to its parent is supplied by the caller, not by the codec.

On merge it SHALL:
- take the rows of `storage.table`, ordered by `id` ascending;
- leave out any row whose `reference_id` is in the context's `removed`;
- map each remaining row to `{ permid }`, plus the label `storage.link` names when the context's `labels`
  holds one for that id;
- emit the result under `storage.property`. The result SHALL be `[]` when there are no rows or every row was
  removed, so the key is never left out.

On split it SHALL:
- read `permid` from each item and ignore every other key;
- map each permid to that reference's head `id`;
- emit one row of `storage.table` carrying `reference_id` per item, in item order, and no columns;
- throw for a permid whose head is removed;
- emit nothing when the property is absent or `null`.

An unresolvable permid on split, or an unresolvable id on merge, SHALL throw naming `referenceLinks` and the
value. Ids SHALL be keyed as strings.

#### Scenario: Child rows to links
- **WHEN** a stored collection has child rows citing `refs.id` 12 (id 3) and 7 (id 2), and ref 7 is titled "Fossil leaves" while ref 12 has no title
- **THEN** the merged `additionalReferences` is `[{ permid: <7's permid>, title: "Fossil leaves" }, { permid: <12's permid> }]`

#### Scenario: Removed reference omitted
- **WHEN** one of a collection's two child rows cites a soft-removed head
- **THEN** the merged `additionalReferences` holds only the other one

#### Scenario: Nothing left
- **WHEN** a collection has no child rows, or every child row cites a soft-removed head
- **THEN** the merged `additionalReferences` is `[]`

#### Scenario: Label ignored on split
- **WHEN** a merged `additionalReferences` with titled items is split
- **THEN** one `additional_collection_refs` row with `reference_id` is emitted per item, and no `title` reaches the jsonb, a column or a row

#### Scenario: Removed reference may not be cited
- **WHEN** a payload's `additionalReferences` names the permid of a soft-removed head
- **THEN** `split` throws naming `referenceLinks`

### Requirement: `storageSelects` and `codecKeySites` describe what a reader selects
`payloadSchemas/lib/storage.js` SHALL export:
- `storageSelects(source)`: one `{ column, expression }` per column `storageColumns(source)` returns. The
  expression is the codec's `select(column)` when the column's codec declares one, and the quoted column
  otherwise.
- `codecKeySites(source)`: a `Map` from each looked-up table to `{ columns, children }`:
  - `columns` lists the parent columns that `x-storage` names for codecs reading that table;
  - `children` maps each child table named by such a codec to that codec's `keyColumn`.

  A reader restricts the codec context to the keys found at those sites.

A codec MAY declare `select(column)`, which returns the SQL expression its `merge` expects for that column. A
codec annotated with a child `table` MAY declare `keyColumn`. Both are optional. A codec without them
behaves as before.

#### Scenario: A column read through an expression
- **WHEN** `storageSelects(collectionSource)` is called
- **THEN** `location` is selected as `ST_AsGeoJSON("location")::json`, and `permid` and `reference_id` are selected as plain quoted columns

#### Scenario: Keys in a column and in child rows
- **WHEN** `codecKeySites(collectionSource)` is called
- **THEN** it maps `refs` to `{ columns: ["reference_id"], children: { additional_collection_refs: ["reference_id"] } }`

#### Scenario: Keys in a column only
- **WHEN** `codecKeySites(authoritySource)` is called
- **THEN** it maps `refs` to `{ columns: ["reference_id"], children: {} }`

## MODIFIED Requirements

### Requirement: Annotation vocabulary
Sources SHALL use these annotations:
- `x-enumFrom`: defined by the payload-schema-enums capability.
- `x-storage` on a property: the property is not stored in the entity's jsonb. Its value is `{ column: <name> }`, `{ column: <name>, codec: <name> }`, or `{ table: <name>, codec: <name> }`.
- `readOnly: true` (standard JSON Schema) on a property: the value is supplied by the server and accepted in no input. `readOnly` MAY appear at any depth. A property is server-supplied when the server assigns it (`permid`, `legacyIDs`, person `totalHours`) or when it is resolved from another resource (a link's label and `href`).
- `x-link: { target, label }` on a property, or on the `items` of an array property: the value, or each item, is a link to a resource of route group `target`, embedding that resource's `label` field. It SHALL be declared only through the `link` helper.
- `x-create` on an object schema: a subschema applied at that node only in the `in-create` variant.

`readOnly` and `x-storage` SHALL be independent. For the collection and specimen sources:
- `permid` SHALL carry both.
- `legacyIDs` SHALL carry `readOnly` only.
- collection `location.coordinates.latitude` and `longitude` SHALL carry `x-storage: { column: "location", codec: "wgs84Point" }`.
- collection `primaryReference` SHALL be a link property carrying `x-storage: { column: "reference_id", codec: "referencePermid" }` and no `readOnly` of its own.
- collection `additionalReferences` SHALL be an array whose `items` are links, carrying `x-storage: { table: "additional_collection_refs", codec: "referenceLinks" }` and no `readOnly` of its own.

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

#### Scenario: A link on array items
- **WHEN** the collection source is inspected at `additionalReferences`
- **THEN** `x-storage` sits on the array and `x-link` on its `items`, and neither node carries `readOnly`

#### Scenario: Privileged but writable
- **WHEN** the person source is inspected at `role`, `authorizer` and `active`
- **THEN** none of them carries `readOnly`, and each carries `x-storage`

#### Scenario: Person read-only set
- **WHEN** the person `patch-guard` variant is derived
- **THEN** its `propertyNames.not.enum` is exactly `permid`, `legacyIDs` and `totalHours`

#### Scenario: Credentials are not a payload field
- **WHEN** the person source is inspected
- **THEN** it defines no `password` property, because credentials are handled by a separate flow, and no `createdAt` property, matching collection and specimen

### Requirement: The `db` variant describes the jsonb at rest
The `db` variant SHALL:
- remove every property carrying `x-storage`, and remove its name from any `required` list;
- keep `readOnly` properties that carry no `x-storage`;
- keep base `required` lists;
- drop every `x-create`;
- keep both resolved and inline enums.

#### Scenario: Column-backed fields absent
- **WHEN** the collection `db` variant is derived
- **THEN** it has no `permid`, `primaryReference`, `additionalReferences`, `location.coordinates.latitude`, or `location.coordinates.longitude` property, yet keeps `location.coordinates.basis` and `altitude`

#### Scenario: Stored jsonb with a stored-elsewhere key fails
- **WHEN** a collection payload containing a top-level `permid` is validated against the `db` variant
- **THEN** validation fails on the unevaluated property

#### Scenario: Create-only rules not applied
- **WHEN** a collection payload with `admin0: "US"` and no `admin1` is validated against the `db` variant
- **THEN** validation passes

### Requirement: The `in-create` variant enforces create-time completeness
The `in-create` variant SHALL:
- remove every `readOnly` property, at any depth, and remove its name from the `required` list of the node that declared it;
- keep `x-storage` properties;
- keep base `required` lists;
- merge each node's `x-create` into that node as an `allOf` entry.

For the collection source, `x-create` SHALL:
- at the root, require `context` and `primaryReference`;
- at `location.coordinates`, require `latitude` and `longitude`;
- at `ages.measurements[]`, require `error` and `method`;
- at `location.toponym.administrativeArea`, carry `if: { required: ["admin0"], properties: { admin0: { enum: ["US","CN","RU","AU","CA"] } } }, then: { required: ["admin1"] }`.

#### Scenario: Read-only field rejected on create
- **WHEN** a create payload includes `permid` or `legacyIDs`
- **THEN** validation fails on the unevaluated property

#### Scenario: A link's label rejected on create
- **WHEN** an authority create body carries `reference: { permid: "<p>", title: "x" }`
- **THEN** validation fails on `/reference/title`, and `reference: { permid: "<p>" }` passes

#### Scenario: A link item's label rejected on create
- **WHEN** a collection create body carries `additionalReferences: [{ permid: "<p>", title: "x" }]`
- **THEN** validation fails on `/additionalReferences/0/title`, and `additionalReferences: [{ permid: "<p>" }]` passes

#### Scenario: Primary reference required on create
- **WHEN** an otherwise complete collection create body has no `primaryReference`
- **THEN** validation fails requiring it, and the same body with `primaryReference` and no `additionalReferences` passes

#### Scenario: admin1 required for listed countries
- **WHEN** a create payload has `location.toponym.administrativeArea: { admin0: "CA" }`
- **THEN** validation fails requiring `admin1`

#### Scenario: admin1 optional elsewhere
- **WHEN** a create payload has `location.toponym.administrativeArea: { admin0: "FR" }` and is otherwise complete
- **THEN** validation passes

### Requirement: The `out` variant describes a full response
The `out` variant SHALL:
- keep all properties, including `x-storage` and `readOnly` ones;
- keep base `required` lists;
- drop every `x-create`;
- remove `enum` from every schema that carries `x-enumFrom`, keeping the `x-enumFrom` annotation;
- keep inline enums;
- allow `null` for every **property** carrying `x-link`, meaning the linked resource has been removed. No other variant allows it. A link schema reached through `items` SHALL NOT allow `null`, because a removed item is omitted, not nulled.

#### Scenario: Dictionary value removed after storage
- **WHEN** a stored collection holds a `lithology` value that is no longer in `dictionaries.lithologies`, and its merged response is validated against `out`
- **THEN** validation passes

#### Scenario: Column-backed fields present
- **WHEN** the collection `out` variant is derived
- **THEN** it defines `permid`, `primaryReference`, `additionalReferences`, `latitude`, and `longitude`

#### Scenario: A removed link target
- **WHEN** an authority response has `reference: null`, or a collection response has `primaryReference: null`
- **THEN** it is valid against `out`, and a create body with that link `null` is invalid against `in-create`

#### Scenario: A null link item
- **WHEN** a collection response has `additionalReferences: [null]`
- **THEN** it is invalid against `out`

### Requirement: Split and merge are driven by `x-storage`
`split(source, payload, ctx)` SHALL return `{ jsonb, columns, children }`:
- `jsonb` is the payload with every `x-storage` property removed;
- `columns` maps column names to storage values;
- `children` maps child table names to arrays of rows.

`merge(source, { jsonb, columns, children }, ctx)` SHALL be its inverse. A property with `x-storage.column`
and no codec SHALL map one-to-one to that column. A codec SHALL receive all sibling properties that name it
and produce one storage value or one set of child rows, and SHALL provide the inverse for `merge`. `ctx` is
the codec context defined below; it SHALL be optional, and a codec that declares no sources SHALL ignore it.

A codec serving a single property SHALL receive:
- that property's name as `storage.property`, and SHALL read and emit the value under that name;
- the property's `x-link`, or its `items`' `x-link`, as `storage.link`.

A codec serving several properties (`wgs84Point`) receives neither, and names its own keys.

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
- **THEN** `wgs84Point` behaves exactly as before, and the reference codecs throw for want of a context

#### Scenario: Authority round trip ignores the label
- **WHEN** a stored authority is merged (yielding `reference: { permid, title }`), its root read-only properties are removed, and the result is split
- **THEN** `columns.reference_id` equals the stored value

#### Scenario: One codec under two property names
- **WHEN** an authority and a collection are merged
- **THEN** `referencePermid` emits the authority's `reference` and the collection's `primaryReference`

#### Scenario: Collection round trip with a repeated primary
- **WHEN** a stored collection with `reference_id = 7` and child rows citing 7 and 12 is merged, and the result is split
- **THEN** `columns.reference_id` is `"7"` and the child rows cite 7 and 12, in their stored order

### Requirement: A codec declares the lookup sources it needs
A codec that cannot be computed from the payload alone SHALL declare a `sources` array. Each entry SHALL be
`{ table: <qualified name>, key: <column>, value: <column> }`, naming a table to read and the two columns
that form the mapping. It MAY carry `versioned: true` to declare that the table holds a succession lineage,
and `payload: <column>` to name the table's jsonb column, from which link labels are read.
`x-storage` SHALL NOT carry the lookup's table or columns: the annotation keeps the three forms the annotation
vocabulary defines, and the codec is what knows its own source.

`collectCodecSources(source)` SHALL walk the source's `x-storage` codecs and return the union of their
declared sources, with duplicates removed. For a property that carries `x-link`, or whose `items` carry it,
the returned source SHALL carry `labels` listing that link's `label`. Duplicates SHALL be identified by
`table`, `key` and `value`, and their `labels` lists SHALL be merged. A source carrying `labels` SHALL
declare `payload`.

`codecKeyColumns(source)` SHALL return, per looked-up table, the `x-storage` columns whose values are that
source's keys, so that a caller reading rows in batches can build its selection by following the annotations
rather than by naming the columns itself. A codec whose `x-storage` names a child table rather than a column
contributes nothing. A looked-up table that any such codec in the source also reads SHALL be left out of the
map entirely, even when another codec reads it through a column, because some of its keys live in child rows.
A caller SHALL read such a source in full rather than per batch. `codecKeySites` is the function that also
reports child-row keys.

When a property carries both `x-enumFrom` and a codec declaring a source in the `dictionaries` schema, the
two SHALL name the same table. Source validation SHALL throw naming the property when they do not, because
the accepted values and the stored key would otherwise be free to drift apart.

#### Scenario: Sources collected from the source schema
- **WHEN** `collectCodecSources(personSource)` is called
- **THEN** it returns the `dictionaries.roles` and `persons` entries declared by `roleName` and `personPermid`, each once

#### Scenario: A link asks for its label
- **WHEN** `collectCodecSources(authoritySource)` is called
- **THEN** it returns one `refs` source carrying `payload: "reference"` and `labels: ["title"]`

#### Scenario: Link items ask for their label
- **WHEN** `collectCodecSources(collectionSource)` is called
- **THEN** it returns one `refs` source carrying `payload: "reference"` and `labels: ["title"]`, shared by `primaryReference` and `additionalReferences`

#### Scenario: Annotation carries no lookup detail
- **WHEN** the person source is inspected at `role`
- **THEN** its `x-storage` is exactly `{ column: "role_id", codec: "roleName" }`

#### Scenario: Enum and codec disagree
- **WHEN** a property carries `x-enumFrom: { table: "genders", column: "name" }` and a codec declaring `dictionaries.roles`
- **THEN** source validation throws naming that property

#### Scenario: A child-table codec offers no key columns
- **WHEN** `codecKeyColumns(collectionSource)` is called
- **THEN** it returns no entry for `refs`, although `primaryReference` names `reference_id`, because `referenceLinks` reads `refs` through `additional_collection_refs` rows

### Requirement: `wgs84Point` codec
The `wgs84Point` codec SHALL:
- map sibling `latitude` and `longitude` to the text `SRID=4326;POINT(<longitude> <latitude>)`;
- map both absent to a NULL column;
- throw when exactly one of the two is present.

On merge it SHALL accept the column as GeoJSON (as selected by `ST_AsGeoJSON(location)::json`) and emit `latitude = coordinates[1]` and `longitude = coordinates[0]`. A NULL column SHALL emit neither.

It SHALL declare `select(column)`, returning `ST_AsGeoJSON("<column>")::json`, so a reader selects the
column in the form merge expects without naming PostGIS itself.

#### Scenario: Coordinates to geography text
- **WHEN** a payload has `latitude: 45.5, longitude: -110.25`
- **THEN** `columns.location` is `SRID=4326;POINT(-110.25 45.5)`

#### Scenario: Half a coordinate pair
- **WHEN** a payload has `latitude` but no `longitude`
- **THEN** `split` throws

#### Scenario: Select expression
- **WHEN** `wgs84Point.select("location")` is called
- **THEN** it returns `ST_AsGeoJSON("location")::json`

### Requirement: `referencePermid` codec
The `referencePermid` codec SHALL declare the source
`{ table: "refs", key: "id", value: "permid", versioned: true, payload: "reference" }`, the same source
`referenceList` declares.

It serves one link property and reads and emits it under `storage.property`: authority `reference`, and
collection `primaryReference`.

On merge it SHALL map the column `x-storage` names to the link object:
- a NULL column SHALL emit no property;
- an id listed in the context's `removed` SHALL emit `null`;
- any other id SHALL emit `{ permid }`, plus the label `storage.link` names when the context's `labels` holds one for that id.

On split it SHALL read the link's `permid`, ignore every other key of the link object, and map the permid to
that reference's head `id` in the column `x-storage` names. An absent or `null` link SHALL emit no
column. A permid whose head is removed SHALL throw, because nothing may cite a removed reference.

Ids SHALL be keyed as strings, as in `referenceList`, because `refs.id` is a bigint that node-postgres
returns as a string.

An unresolvable permid on split, or an unresolvable id on merge, SHALL throw naming `referencePermid` and the
value. With `authorities.reference_id` and `collections.reference_id` NOT NULL foreign keys that the swing
trigger keeps on the head, an unresolvable id is an integrity failure, not a data state.

Because the codec is annotated with a `column`, `codecKeyColumns` SHALL map `refs` to that column for a source
using it, so that a batched caller can select `refs` by the ids its rows hold, unless a child-table codec in
the same source also reads `refs`.

#### Scenario: Permid to id
- **WHEN** an authority payload names `reference: { permid }` whose permid belongs to the head ref at `refs.id = 7`
- **THEN** `columns.reference_id` is `"7"`

#### Scenario: Id to link object
- **WHEN** a stored authority has `reference_id = 7`, and that ref's title is "Fossil leaves"
- **THEN** the merged payload's `reference` is `{ permid: <that ref's permid>, title: "Fossil leaves" }`, and no `refs.id` appears in the payload

#### Scenario: Collection primary
- **WHEN** a stored collection has `reference_id = 7`
- **THEN** the merged payload's `primaryReference` is that ref's link object, and no `reference` key is emitted

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

### Requirement: `referenceList` codec
The `referenceList` codec SHALL declare the source
`{ table: "refs", key: "id", value: "permid", versioned: true }`.

It maps a `references[]` array to the parent row's `reference_id` column plus rows of the child table that
the property's `x-storage` names. It SHALL NOT name any entity or child table itself. Its one caller is the
schema source, which annotates it with `additional_schema_refs`. The foreign key from a child row back to its
parent is supplied by the caller that reads or writes the child rows, not by the codec. The collection source
no longer uses it (see "The collection source declares its stored references").

On split it SHALL:
- sort `references[]` by numeric `order`;
- resolve the first entry's `permid` to that reference's head `id` and emit it as `columns.reference_id`;
- resolve the remaining entries' permids and emit them, in sequence, as rows of the `x-storage` child table carrying `reference_id`.

On merge it SHALL emit the primary reference with `order: "1"`, followed by child rows ordered by the child
table's `id` ascending with `order: "2"`, `"3"`, and so on, mapping each stored `reference_id` back to that
reference's `permid`.

Each item names its reference by `permid`, the reference's own id field, so a `references[]` item uses the
same name as the reference it cites and as every other link object. It SHALL carry a reference's permid, not
`refs.id`: this project exposes permids rather than internal ids. No item SHALL carry `referenceID`, the
item key's earlier name. The storage topology is unchanged by the codec: the primary occupies the parent's `reference_id`,
the rest are child rows, and those rows have no order column, so order is re-derived on merge.

An unresolvable permid on split, or an unresolvable `reference_id` on merge, SHALL throw naming
`referenceList` and the value.

The codec was named `collectionReferences` while collection was its only caller. No codec by that name SHALL
remain in the registry.

#### Scenario: Order normalized on round trip
- **WHEN** a schema payload with references ordered `"1"` and `"5"` is split and merged back
- **THEN** the merged references carry orders `"1"` and `"2"` with the same `permid`s in the same sequence

#### Scenario: Primary goes to the column
- **WHEN** a schema payload's references are `[{ permid: "<permid-B>", order: "2" }, { permid: "<permid-A>", order: "1" }]` and those permids belong to `refs.id` 7 and 12 respectively
- **THEN** `columns.reference_id` is `7` and one child row carries `reference_id` `12`

#### Scenario: Merge yields permids
- **WHEN** a stored schema has `reference_id = 7` and one child row with `reference_id = 12`
- **THEN** the merged payload's `references[]` items carry those two references' permids under `permid`, no item carries `referenceID`, and no `refs.id` appears anywhere in the payload

#### Scenario: Child table follows the annotation
- **WHEN** a schema payload with two references is split
- **THEN** the second reference is emitted as a row of `additional_schema_refs`, and nothing is emitted for `additional_collection_refs`

#### Scenario: Superseded reference is never cited
- **WHEN** the ref at `id = 7` is superseded by a new version sharing its permid
- **THEN** splitting a payload naming that permid yields the new head's `id`, not `7`

#### Scenario: Unknown reference permid
- **WHEN** a payload's reference item names a `permid` held by no reference
- **THEN** `split` throws naming `referenceList` and that permid

#### Scenario: Old name is gone
- **WHEN** a source names the codec `collectionReferences`
- **THEN** `split` and `merge` throw naming it as an unknown codec

### Requirement: Link properties are declared with the `link` helper
`payloadSchemas/lib/links.js` SHALL export `link({ target, label })`, returning the schema of a link: the
value of a link property, or the `items` of an array of links.

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

#### Scenario: Unknown key in a link item
- **WHEN** a collection response's `additionalReferences` item carries `{ permid, title, href, order }` and is validated against `out`
- **THEN** validation fails on `order`

#### Scenario: Label may be absent
- **WHEN** an authority's merged `reference` is `{ permid }`, because the reference has no title
- **THEN** it is valid against `out`
