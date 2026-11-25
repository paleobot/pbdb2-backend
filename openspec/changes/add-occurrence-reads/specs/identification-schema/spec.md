## MODIFIED Requirements

### Requirement: The identification payload schema keeps the names as written, with a resolution per rank
`payloadSchemas/identification.schema.js` SHALL export `identificationSource`, the annotated source for the jsonb payload, from
which every variant is derived. Its payload SHALL hold `identification` (an object with optional `genus`, `subgenus`, `species`
and `subspecies`, each an object with optional `resolution` and `name`), `plantOrgans` (an array of closed-enum values),
`comments`, and read-only `legacyIDs` (`oldpbdbID`, `oldpbdbReidID`). It SHALL NOT hold abundance. No property SHALL be required.

The source SHALL also declare two link properties that are columns, not payload: `taxon`,
`link({ target: "taxa", label: "name" })` with `x-storage: { column: "taxon_permid", codec: "taxonPermid" }`, and
`reference`, `link({ target: "references", label: "title" })` with
`x-storage: { column: "reference_id", codec: "referencePermid" }`. Neither carries `readOnly` of its own. Because both
carry `x-storage`, the `db` variant SHALL NOT declare them, so the stored jsonb and its validation are unchanged. The
occurrence and collection the identification belongs to SHALL NOT be properties of the source: the API reaches the
identification through its occurrence (`occurrence-reads`).

Resolutions SHALL be closed inline enums: the shared set `aff.`, `cf.`, `ex gr.`, `sensu lato`, `sensu stricto`, `?`, `"` and
`informal`, plus `n. gen.` for genus, `n. subgen.` for subgenus, `n. sp.` for species, and `n. ssp.`, `var`, `morph`, `forma` and
`mut` for subspecies. The empty string SHALL NOT be a valid resolution; "no resolution" is the absent key.

#### Scenario: Every variant compiles
- **WHEN** every variant of the identification source is derived and compiled in strict mode
- **THEN** each compiles

#### Scenario: A payload with no name validates
- **WHEN** the `db` variant validates `{}`
- **THEN** it passes

#### Scenario: The ditto mark is admitted
- **WHEN** a genus resolution is `"`
- **THEN** the `db` variant accepts it

#### Scenario: A resolution belongs to its rank
- **WHEN** a genus resolution is `n. sp.`
- **THEN** the `db` variant rejects it

#### Scenario: Abundance is not an identification field
- **WHEN** a payload contains `abundance`
- **THEN** the `db` variant rejects it

#### Scenario: Unknown keys are rejected
- **WHEN** a payload contains a key the schema does not declare
- **THEN** the `db` variant rejects it

#### Scenario: Links are not stored
- **WHEN** the `db` variant of the identification source is derived
- **THEN** it declares no `taxon` and no `reference`, and a payload carrying either is rejected as an unknown key

#### Scenario: Links are part of the read
- **WHEN** the `out` variant of the identification source is derived
- **THEN** it declares `taxon` and `reference` as link objects
