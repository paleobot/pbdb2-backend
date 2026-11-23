/*
 * Annotated source for the occurrence abundance payload. Every schema used anywhere (jsonb
 * at rest, create body, PATCH guard, response) is derived from this one object;
 * see payloadSchemas/lib/variants.js and payloadSchemas/DESIGN_NOTES.md.
 * Annotations are described in collection.schema.js.
 *
 * How many specimens or individuals were recorded for an occurrence. It is its own
 * record, keyed by the occurrence's permid (occurrence_abundances.occurrence_permid),
 * with its own people and reference, so re-identifying an occurrence never touches it.
 *
 * Both fields are free text: abund_value is not always a number ("3-5", "common") and
 * abund_unit has about 15 values that Classic's UI enforced loosely. Promote the unit
 * to an enum only if a later pass wants it.
 */

const occurrenceAbundanceProperties = {
	permid: {
		type: "string",
		readOnly: true,
		"x-storage": { column: "permid" },
		description: "Permanent identifier, constant across versions"
	},
	legacyIDs: {
		type: "object",
		readOnly: true,
		properties: {
			oldpbdbID: {
				type: "string",
				description: "Legacy occurrence_no whose abund_value and abund_unit this abundance came from"
			},
		}
	},
	value: {type: "string"},
	unit: {type: "string"}
}

export const occurrenceAbundanceSource = {
	$schema: "https://json-schema.org/draft/2020-12/schema",
	$id: "https://pbdb2.example.com/schemas/occurrenceAbundance.json",
	title: "Occurrence abundance",
	description: "An abundance (how many were recorded for an occurrence) payload in the PBDB database",
	type: "object",
	properties: occurrenceAbundanceProperties,
	unevaluatedProperties: false,
};

export default occurrenceAbundanceSource;
