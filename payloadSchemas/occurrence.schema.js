/*
 * Annotated source for the occurrence payload. Every schema used anywhere (jsonb
 * at rest, create body, PATCH guard, response) is derived from this one object;
 * see payloadSchemas/lib/variants.js and payloadSchemas/DESIGN_NOTES.md.
 * Annotations are described in collection.schema.js.
 *
 * An occurrence is one identification of a fossil in a collection. A
 * reidentification is another occurrence row that points back at the one it
 * supersedes (occurrences.reidentifies_id), so this one payload serves both.
 *
 * The occurrence's other links (taxon_permid, collection_id, reference_id,
 * reidentifies_id) get API fields when the API is designed.
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

const occurrenceProperties = {
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
				description: "Legacy occurrence_no for occurrences migrated from old PBDB"
			},
			oldpbdbReidID: {
				type: "string",
				description: "Legacy reid_no; set only on rows that came from reidentifications"
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
	abundance: {
		type: "object",
		properties: {
			value: {type: "string"},
			unit: {type: "string"}
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

export const occurrenceSource = {
	$schema: "https://json-schema.org/draft/2019-09/schema",
	$id: "https://pbdb2.example.com/schemas/occurrence.json",
	title: "Occurrence",
	description: "An occurrence (one identification of a fossil in a collection) payload in the PBDB database",
	type: "object",
	properties: occurrenceProperties,
	unevaluatedProperties: false,
};

export default occurrenceSource;
