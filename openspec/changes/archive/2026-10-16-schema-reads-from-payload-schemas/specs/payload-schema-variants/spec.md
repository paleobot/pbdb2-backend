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
- `primaryReference` SHALL be a link property carrying `x-storage: { column: "reference_id", codec: "referencePermid" }` and no `readOnly` of its own, as on collection.
- `additionalReferences` SHALL be an array whose `items` are links, carrying `x-storage: { table: "additional_schema_refs", codec: "referenceLinks" }` and no `readOnly` of its own, as on collection.

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

### Requirement: `referencePermid` codec
The `referencePermid` codec SHALL declare the source
`{ table: "refs", key: "id", value: "permid", versioned: true, payload: "reference" }`, the same source
`referenceLinks` declares.

It serves one link property and reads and emits it under `storage.property`: authority `reference`,
collection `primaryReference`, and schema `primaryReference`.

On merge it SHALL map the column `x-storage` names to the link object:
- a NULL column SHALL emit no property;
- an id listed in the context's `removed` SHALL emit `null`;
- any other id SHALL emit `{ permid }`, plus the label `storage.link` names when the context's `labels` holds one for that id.

On split it SHALL read the link's `permid`, ignore every other key of the link object, and map the permid to
that reference's head `id` in the column `x-storage` names. An absent or `null` link SHALL emit no
column. A permid whose head is removed SHALL throw, because nothing may cite a removed reference.

Ids SHALL be keyed as strings, as in `referenceLinks`, because `refs.id` is a bigint that node-postgres
returns as a string.

An unresolvable permid on split, or an unresolvable id on merge, SHALL throw naming `referencePermid` and the
value. With `authorities.reference_id`, `collections.reference_id` and `schemas.reference_id` NOT NULL foreign keys that the swing
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

#### Scenario: Schema primary
- **WHEN** a stored schema has `reference_id = 7`
- **THEN** the merged payload's `primaryReference` is that ref's link object, and no `references` key is emitted

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

### Requirement: The schema source
`schemaSource` SHALL declare exactly these root properties:

| property | schema | annotations |
|---|---|---|
| `permid` | string | `readOnly`, `x-storage: { column: "permid" }` |
| `legacyIDs` | object with `pbotID`: string | `readOnly` |
| `primaryReference` | `link({ target: "references", label: "title" })`: `{ permid, title, href }` | `x-storage: { column: "reference_id", codec: "referencePermid" }` |
| `additionalReferences` | array whose `items` are `link({ target: "references", label: "title" })` | `x-storage: { table: "additional_schema_refs", codec: "referenceLinks" }` |
| `title` | string | |
| `year` | string, `maxLength: 4` | |
| `purpose` | string | |
| `authors` | array, `minItems: 1`, of `{ familyName: string, givenName: string, order: integer ≥ 1 }` | |
| `acknowledgments` | string | |
| `partsPreserved` | array of strings | items `x-enumFrom: { table: "parts_preserved", column: "name" }` |
| `notableFeatures` | array of strings | items `x-enumFrom: { table: "notable_features", column: "name" }` |

The references SHALL be declared exactly as on the collection source ("The collection source declares its
stored references"): `additionalReferences` is an unordered set with no `order`, no `minItems` and no
`uniqueItems`; it holds every `additional_schema_refs` row of the schema, including one citing the
primary; and neither property carries `readOnly`. The source SHALL NOT declare a `references` property.
Its comment SHALL say that the rows are returned as stored and SHALL point at
`docs/api-design-backlog.md`, "Collection reference model", whose answer applies to schemas as to
collections.

Base `required` SHALL be `title` and `year`. Root `x-create` SHALL require `primaryReference` and SHALL
constrain `year` to `pattern: "^[0-9]{4}$"`, declared with `type: "string"` so that the `in-create` variant
compiles in strict mode. `additionalReferences` is optional on create. The `db` variant SHALL declare
neither reference property, SHALL require only `title` and `year`, as the legacy schema did, and SHALL
carry no pattern on `year`.

Every jsonb key SHALL keep the name and shape the PBot schema migration writes. The source SHALL declare no
character or state tree: whether the API creates a schema's characters and states in the same call is not
decided, and the stored jsonb holds none. The commented-out `$defs` and `schemaDefinition` sketches MAY remain
in the file as comments.

`authorizer_person_id` and `enterer_person_id` SHALL NOT be exposed as payload fields.

#### Scenario: Stored payload validates at rest
- **WHEN** `{ legacyIDs: { pbotID: "p-1" }, title: "Fungi Morphology", year: "2023", purpose: "…", authors: [{ order: 1, givenName: "Claire", familyName: "Cleveland" }], partsPreserved: ["leaf"] }` is validated against the resolved `db` variant
- **THEN** it passes, with no reference property and no `permid` present

#### Scenario: Legacy requirements carried over
- **WHEN** a payload omitting `title`, or omitting `year`, or with `year: "20230"`, or with `authors: []`, or with an author `order: 0`, or with an undeclared key, is validated against `db`
- **THEN** it fails

#### Scenario: Dictionary values enforced
- **WHEN** a payload with `partsPreserved: ["bark"]` or `notableFeatures: ["pith structure"]` is validated against the resolved `db` variant
- **THEN** it fails, because neither value is in its dictionary table

#### Scenario: Primary reference required on create
- **WHEN** a create body with `title` and `year` but no `primaryReference` is validated against `in-create`
- **THEN** it fails, and the same body with `primaryReference: { permid: "<p>" }` and no `additionalReferences` passes

#### Scenario: The old references array is rejected
- **WHEN** a create body carries `references: [{ permid: "<p>", order: "1" }]` in place of `primaryReference`
- **THEN** `in-create` rejects it

#### Scenario: No order on an additional reference
- **WHEN** a create body carries `additionalReferences: [{ permid: "<p>", order: "2" }]`
- **THEN** validation against `in-create` fails on `order`

#### Scenario: The primary may repeat among the additional references
- **WHEN** a merged schema has `primaryReference.permid` equal to the `permid` of one `additionalReferences` item
- **THEN** it is valid against `out`

#### Scenario: Four-digit year on create
- **WHEN** create bodies otherwise valid carry `year: "0"`, `year: "abc"` and `year: "2023"`
- **THEN** `in-create` rejects the first two and accepts the third

#### Scenario: Patch guard blocks the read-only fields
- **WHEN** the `patch-guard` variant is derived
- **THEN** it rejects exactly `permid` and `legacyIDs` as keys

#### Scenario: No tree in the payload
- **WHEN** the schema source is inspected
- **THEN** it declares no `characters`, `states` or `schemaDefinition` property and no `$defs`

### Requirement: `referenceLinks` codec
The `referenceLinks` codec SHALL declare the source
`{ table: "refs", key: "id", value: "permid", versioned: true, payload: "reference" }`, the same one that
`referencePermid` declares. It SHALL declare `keyColumn: "reference_id"`, the
child-row column that holds a `refs.id`.

It maps an unordered array of reference links, the property it serves (`storage.property`), to rows of the
child table its `x-storage` names. It writes no column on the parent. The foreign key from a child row back
to its parent is supplied by the caller, not by the codec. It has two callers: collection
`additionalReferences` (`additional_collection_refs`) and schema `additionalReferences`
(`additional_schema_refs`).

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

#### Scenario: Child table follows the annotation
- **WHEN** a schema payload with `additionalReferences` naming two references is split
- **THEN** two rows of `additional_schema_refs` are emitted, and nothing is emitted for `additional_collection_refs`

## REMOVED Requirements

### Requirement: `referenceList` codec
**Reason**: Its one caller, the schema source, now declares `primaryReference` and `additionalReferences`
through `referencePermid` and `referenceLinks`, as the collection source does. Neither answer the
committee may give on the reference model keeps it: if order is wanted, `reference_id` is dropped and
the child table gains a position column, and if not, the two-field shape stays.
**Migration**: Use `referencePermid` for the primary and `referenceLinks` for the additional references.
A `references[]` payload becomes `primaryReference: { permid }` plus `additionalReferences: [{ permid }]`,
with no `order`. A source naming `referenceList` throws as an unknown codec.
