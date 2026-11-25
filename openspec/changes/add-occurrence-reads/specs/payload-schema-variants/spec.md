## MODIFIED Requirements

### Requirement: A codec declares the lookup sources it needs
A codec that cannot be computed from the payload alone SHALL declare a `sources` array. Each entry SHALL be
`{ table: <qualified name>, key: <column>, value: <column> }`, naming a table to read and the two columns
that form the mapping. It MAY carry `versioned: true` to declare that the table holds a succession lineage,
and either `payload: <column>`, naming the table's jsonb column from which link labels are read as keys, or
`labelColumns: true`, declaring that link labels are plain columns of the table (a derived table with no
jsonb, such as `taxa`).
`x-storage` SHALL NOT carry the lookup's table or columns: the annotation keeps the three forms the annotation
vocabulary defines, and the codec is what knows its own source.

`collectCodecSources(source)` SHALL walk the source's `x-storage` codecs and return the union of their
declared sources, with duplicates removed. For a property that carries `x-link`, or whose `items` carry it,
the returned source SHALL carry `labels` listing that link's `label`. Duplicates SHALL be identified by
`table`, `key` and `value`, and their `labels` lists SHALL be merged. A source carrying `labels` SHALL
declare `payload` or `labelColumns`, and SHALL NOT declare both.

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

#### Scenario: A column-labelled source
- **WHEN** `collectCodecSources(identificationSource)` is called
- **THEN** it returns a `taxa` source carrying `labelColumns: true` and `labels: ["name"]`, and a `refs` source carrying `payload: "reference"` and `labels: ["title"]`

#### Scenario: Both label forms declared
- **WHEN** a codec source declares both `payload` and `labelColumns`
- **THEN** source validation throws naming the codec

### Requirement: The codec context is loaded per selection and applied purely
`loadCodecContext(pg, sources, selection, reuse)` SHALL return a `Map` from each source's table name to
`{ byKey, byValue }` lookup maps, both populated from one read per source. The same read SHALL also populate:
- `labels`, a `Map` from key to `{ <label>: <value> }`, when the source carries `labels`. Each label is read as `"<payload>"->>'<label>'`, or as the column `"<label>"` when the source declares `labelColumns`, and left out when NULL;
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

#### Scenario: Labels read from a column
- **WHEN** the `taxa` source with `labelColumns: true` and `labels: ["name"]` is loaded for a page citing one taxon
- **THEN** one query reads `"name"` as a column, and `labels` holds `{ name }` for that permid

## ADDED Requirements

### Requirement: `taxonPermid` codec
The `taxonPermid` codec SHALL declare the source `{ table: "taxa", key: "permid", value: "permid", labelColumns: true }`
and serve one property, read and emitted under `storage.property`, from a column holding a `TXN` permid
(`identifications.taxon_permid`). Its `merge` SHALL emit:
- nothing when the column is NULL, so the property is absent;
- `{ permid }` plus the label `storage.link` names, when the context's `labels` holds one for that permid;
- `{ permid }` alone when `taxa` has no row for the permid. This SHALL NOT throw: the column holds a root
  name opinion's permid, which is not a foreign key to `taxa`, and a name opinion whose taxon was not derived
  is data, not a broken invariant.

Its `split` SHALL write the link's `permid` to the column unchanged, and nothing when the property is absent
or `null`. It needs no lookup, since the column holds the permid itself; the column's foreign key to the permid
registry and its `TXN` check are what refuse an unregistered or foreign permid. A write path that must also
require a root `name_opinions` row adds that check there, not here.

The API's `x-storage` selection for this codec SHALL restrict `taxa` by `permid` per page.

#### Scenario: A resolved taxon
- **WHEN** an identification whose `taxon_permid` has a `taxa` row named `Dielasma` is merged
- **THEN** `taxon` is `{ permid, name: "Dielasma" }`

#### Scenario: A taxon permid with no taxa row
- **WHEN** an identification whose `taxon_permid` names a root name opinion with no `taxa` row is merged
- **THEN** `taxon` is `{ permid }`, and nothing is thrown

#### Scenario: No taxon
- **WHEN** an identification with `taxon_permid` NULL is merged
- **THEN** the merged payload has no `taxon` key

#### Scenario: Split writes the permid
- **WHEN** `split(identificationSource, { taxon: { permid: "TXN-38613-69", name: "Tyrannosaurus" } }, ctx)` is called
- **THEN** the columns include `taxon_permid: "TXN-38613-69"`, and the label is ignored

#### Scenario: The identification round trip
- **WHEN** a stored identification is merged and its result split back
- **THEN** `taxon_permid` and `reference_id` are reproduced, whether or not the taxon has a `taxa` row

### Requirement: The occurrence source
`payloadSchemas/occurrence.schema.js` SHALL export `occurrenceSource` (and `default`), the occurrence as the API
reads it (`occurrence-reads`). It SHALL declare `readOnly: true` at its root, because `occurrences` is derived
output with no write path, and its `db` variant is therefore an empty object. Its properties, in this order,
SHALL be:

- `permid`;
- `collection`: `link({ target: "collections", label: "name" })`;
- `reference`: `link({ target: "references", label: "title" })`;
- `identification`: an object of `permid`, `href`, `name` (string or `null`), the four rank objects, `taxon`
  (`link({ target: "taxa", label: "name" })`, or `null`) and `reference`
  (`link({ target: "references", label: "title" })`). The rank objects SHALL be taken from
  `identificationSource.properties.identification.properties`, so that their resolution enums have one
  definition;
- `acceptedTaxon`: `link({ target: "taxa", label: "name" })`, or `null`;
- `plantOrgans`: the identification source's `plantOrgans` schema;
- `abundance`: an object of `value` and `unit` (strings), or `null`;
- `legacyIDs`: `{ oldpbdbID }`.

Properties read from a column SHALL carry descriptive `x-storage` naming it. `occurrences` reads do not use
`merge()`: the source describes the response, and the API's conformance tests keep it true.

#### Scenario: The occurrence out variant describes an occurrence response
- **WHEN** an occurrence single read's `data` is validated against `deriveVariant(occurrenceSource, 'out')`
- **THEN** it is valid

#### Scenario: The occurrence source stores nothing in jsonb
- **WHEN** `deriveVariant(occurrenceSource, 'db')` is derived
- **THEN** it declares no properties

#### Scenario: Resolutions have one definition
- **WHEN** the occurrence source's `identification.genus.resolution` enum is compared with the identification source's
- **THEN** they are the same array

#### Scenario: Writes are refused
- **WHEN** `deriveVariant(occurrenceSource, 'in-create')` is requested
- **THEN** it throws, as for every read-only source
