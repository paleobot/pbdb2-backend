/*
 * Annotated source for the identification payload. Every schema used anywhere (jsonb
 * at rest, create body, PATCH guard, response) is derived from this one object;
 * see payloadSchemas/lib/variants.js and payloadSchemas/DESIGN_NOTES.md.
 * Annotations are described in collection.schema.js.
 *
 * An identification is one statement of what a fossil in a collection is. The first
 * one mints the occurrence; a reidentification is another identification of the same
 * occurrence (identifications.occurrence_permid), so this one payload serves both.
 * The occurrences table is derived from these. How many were found is a different
 * fact with its own provenance: see occurrenceAbundance.schema.js.
 *
 * The identification's other links (taxon_permid, collection_id, reference_id,
 * occurrence_permid) get API fields when the API is designed.
 *
 * The resolution enums mirror Classic's and are kept inline: code will depend on
 * their meaning. The ditto mark '"' is admitted verbatim; Classic's data-entry
 * shorthand for "same as the row above", not an error.
 */

const resolutions = ['aff.', 'cf.', 'ex gr.', 'sensu lato', 'sensu stricto', '?', '"', 'informal'];

// One rank of the name as the identifier wrote it. Absent keys mean "not given".
const rank = (extraResolutions = []) => ({
	type: "object",
	properties: {
		resolution: {type: "string", enum: [...resolutions, ...extraResolutions]},
		name: {type: "string"}
	}
});

const identificationProperties = {
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
				description: "Legacy occurrence_no, on every identification migrated from old PBDB"
			},
			oldpbdbReidID: {
				type: "string",
				description: "Legacy reid_no; set only on identifications that came from reidentifications"
			},
		}
	},
	identification: {
		type: "object",
		description: "The taxon name as the identifier wrote it, with its open-nomenclature qualifiers. Kept for every row, whether or not it resolved to a taxon.",
		properties: {
			genus: rank(['n. gen.']),
			subgenus: rank(['n. subgen.']),
			species: rank(['n. sp.']),
			subspecies: rank(['n. ssp.', 'var', 'morph', 'forma', 'mut'])
		}
	},
	plantOrgans: {
		type: "array",
		items: {
			type: "string",
			enum: ['unassigned', 'leaf', 'seed/fruit', 'axis', 'plant debris', 'marine palyn', 'microspore',
				'megaspore', 'flower', 'seed repro', 'non-seed repro', 'wood', 'sterile axis', 'fertile axis',
				'root', 'cuticle', 'multi organs']
		}
	},
	comments: {type: "string"},
}

export const identificationSource = {
	$schema: "https://json-schema.org/draft/2020-12/schema",
	$id: "https://pbdb2.example.com/schemas/identification.json",
	title: "Identification",
	description: "An identification (one statement of what a fossil in a collection is) payload in the PBDB database",
	type: "object",
	properties: identificationProperties,
	unevaluatedProperties: false,
};

export default identificationSource;
