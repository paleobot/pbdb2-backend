## MODIFIED Requirements

### Requirement: `referenceList` codec
The `referenceList` codec SHALL declare the source
`{ table: "refs", key: "id", value: "permid", versioned: true }`.

It maps a `references[]` array to the parent row's `reference_id` column plus rows of the child table that
the property's `x-storage` names. It SHALL NOT name any entity or child table itself: collection annotates it
with `additional_collection_refs`, schema with `additional_schema_refs`, and the foreign key from a child row
back to its parent is supplied by the caller that reads or writes the child rows, not by the codec.

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
- **WHEN** a payload with references ordered `"1"` and `"5"` is split and merged back
- **THEN** the merged references carry orders `"1"` and `"2"` with the same `permid`s in the same sequence

#### Scenario: Primary goes to the column
- **WHEN** a payload's references are `[{ permid: "<permid-B>", order: "2" }, { permid: "<permid-A>", order: "1" }]` and those permids belong to `refs.id` 7 and 12 respectively
- **THEN** `columns.reference_id` is `7` and one child row carries `reference_id` `12`

#### Scenario: Merge yields permids
- **WHEN** a stored collection has `reference_id = 7` and one child row with `reference_id = 12`
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

### Requirement: The schema source
`schemaSource` SHALL declare exactly these root properties:

| property | schema | annotations |
|---|---|---|
| `permid` | string | `readOnly`, `x-storage: { column: "permid" }` |
| `legacyIDs` | object with `pbotID`: string | `readOnly` |
| `references` | array, `minItems: 1`, of `{ permid: string, order: string }` with both required | `x-storage: { table: "additional_schema_refs", codec: "referenceList" }` |
| `title` | string | |
| `year` | string, `maxLength: 4` | |
| `purpose` | string | |
| `authors` | array, `minItems: 1`, of `{ familyName: string, givenName: string, order: integer ≥ 1 }` | |
| `acknowledgments` | string | |
| `partsPreserved` | array of strings | items `x-enumFrom: { table: "parts_preserved", column: "name" }` |
| `notableFeatures` | array of strings | items `x-enumFrom: { table: "notable_features", column: "name" }` |

Base `required` SHALL be `title`, `year` and `references`. Because `references` is an `x-storage` property,
the `db` variant SHALL neither declare nor require it, and SHALL require only `title` and `year`, as the
legacy schema did.

`x-create` SHALL constrain `year` to `pattern: "^[0-9]{4}$"`, declared with `type: "string"` so that the
`in-create` variant compiles in strict mode. The `db` variant SHALL carry no pattern on `year`.

Every jsonb key SHALL keep the name and shape the PBot schema migration writes. The source SHALL declare no
character or state tree: whether the API creates a schema's characters and states in the same call is not
decided, and the stored jsonb holds none. The commented-out `$defs` and `schemaDefinition` sketches MAY remain
in the file as comments.

`authorizer_person_id` and `enterer_person_id` SHALL NOT be exposed as payload fields.

#### Scenario: Stored payload validates at rest
- **WHEN** `{ legacyIDs: { pbotID: "p-1" }, title: "Fungi Morphology", year: "2023", purpose: "…", authors: [{ order: 1, givenName: "Claire", familyName: "Cleveland" }], partsPreserved: ["leaf"] }` is validated against the resolved `db` variant
- **THEN** it passes, with no `references` and no `permid` present

#### Scenario: Legacy requirements carried over
- **WHEN** a payload omitting `title`, or omitting `year`, or with `year: "20230"`, or with `authors: []`, or with an author `order: 0`, or with an undeclared key, is validated against `db`
- **THEN** it fails

#### Scenario: Dictionary values enforced
- **WHEN** a payload with `partsPreserved: ["bark"]` or `notableFeatures: ["pith structure"]` is validated against the resolved `db` variant
- **THEN** it fails, because neither value is in its dictionary table

#### Scenario: References required on create
- **WHEN** a create body with `title` and `year` but no `references`, or with `references: []`, is validated against `in-create`
- **THEN** it fails

#### Scenario: Reference item needs its permid
- **WHEN** a create body carries `references: [{ order: "1" }]`
- **THEN** `in-create` rejects it for the missing `permid`

#### Scenario: The old item key is rejected
- **WHEN** a create body carries `references: [{ referenceID: "r-1", order: "1" }]`
- **THEN** `in-create` rejects it for the missing `permid`

#### Scenario: Four-digit year on create
- **WHEN** create bodies otherwise valid carry `year: "0"`, `year: "abc"` and `year: "2023"`
- **THEN** `in-create` rejects the first two and accepts the third

#### Scenario: Patch guard blocks the read-only fields
- **WHEN** the `patch-guard` variant is derived
- **THEN** it rejects exactly `permid` and `legacyIDs` as keys

#### Scenario: No tree in the payload
- **WHEN** the schema source is inspected
- **THEN** it declares no `characters`, `states` or `schemaDefinition` property and no `$defs`
