/*
 * Annotated source for the occurrence: the API's read of the derived
 * `occurrences` table (openspec/specs/occurrence-reads/spec.md). Annotations are
 * described in collection.schema.js.
 *
 * An occurrence is derived output (rebuild_occurrences()), never written through
 * the API, so the source is read-only at its root: deriveVariant refuses
 * in-create and patch-guard for it (payloadSchemas/lib/variants.js). Nothing is
 * stored as jsonb, so every top-level property carries x-storage naming where it
 * is read from, and the db variant is an empty object.
 *
 * Occurrence reads do not go through merge(): api/src/lib/occurrence-repository.js
 * reads the cache and the rows it joins one-to-one (the winning identification,
 * the identified taxon, the current abundance) directly. The x-storage here is
 * descriptive, and the API's occurrence conformance tests keep it true.
 *
 * Two references, named apart on purpose: `reference` is the root
 * identification's (where the occurrence was first recorded), and
 * `identification.reference` is the winning identification's (where its current
 * name was published). They differ wherever a reidentification wins with another
 * reference.
 *
 * The embedded identification is the winner with its ranks lifted out of the
 * stored `identification` block; the full record at
 * /occurrences/{permid}/identifications/{permid} keeps them nested, as stored.
 * The rank schemas are the identification source's own, so the resolution enums
 * have one definition.
 */
import { link } from "./lib/links.js";
import { identificationSource } from "./identification.schema.js";

const ranks = identificationSource.properties.identification.properties;

const occurrenceProperties = {
	permid: {
		type: "string",
		readOnly: true,
		"x-storage": { column: "permid" },
		description: "Permanent identifier of the occurrence: its root identification's permid"
	},
	collection: {
		...link({ target: "collections", label: "name" }),
		"x-storage": { column: "collection_id" },
		description: "the collection the fossil was found in"
	},
	reference: {
		...link({ target: "references", label: "title" }),
		"x-storage": { column: "reference_id" },
		description: "the root identification's reference: the publication the occurrence was first recorded from. The reference for the current name is identification.reference"
	},
	identification: {
		type: "object",
		"x-storage": { column: "winning_identification_id" },
		description: "the identification that currently names the occurrence, with its ranks lifted out of the stored identification block. Its full record is at href",
		properties: {
			permid: {
				type: "string",
				description: "permid of the winning identification; equal to the occurrence's when the original identification wins"
			},
			href: {
				type: "string",
				description: "read URL of the winning identification's full record"
			},
			name: {
				type: ["string", "null"],
				description: "the name formatted for display from the ranks; null when no rank has a name. The ranks are the authoritative form"
			},
			genus: ranks.genus,
			subgenus: ranks.subgenus,
			species: ranks.species,
			subspecies: ranks.subspecies,
			taxon: {
				...link({ target: "taxa", label: "name" }),
				description: "the taxon the name resolved to; null when it did not resolve. Carries no name and no href when its permid has no taxa row"
			},
			reference: {
				...link({ target: "references", label: "title" }),
				description: "the winning identification's own reference: where the current name was published"
			}
		},
		required: ["permid", "href", "name", "taxon", "reference"],
		additionalProperties: false
	},
	acceptedTaxon: {
		...link({ target: "taxa", label: "name" }),
		"x-storage": { column: "taxon_permid" },
		description: "the accepted name of the identified taxon's concept; null when the name did not resolve to a taxon"
	},
	plantOrgans: {
		...identificationSource.properties.plantOrgans,
		"x-storage": { column: "plant_organs" },
		description: "the organs named by the highest-ranked identification that names any; absent when none does"
	},
	abundance: {
		type: ["object", "null"],
		"x-storage": { table: "occurrence_abundances" },
		description: "how many were recorded, from the occurrence's current abundance; null when none was recorded",
		properties: {
			value: {type: "string"},
			unit: {type: "string"}
		},
		additionalProperties: false
	},
	legacyIDs: {
		type: "object",
		"x-storage": { column: "oldpbdb_occurrence_no" },
		properties: {
			oldpbdbID: {
				type: "string",
				description: "Legacy occurrence_no, on every occurrence migrated from old PBDB"
			}
		},
		additionalProperties: false
	}
};

export const occurrenceSource = {
	$schema: "https://json-schema.org/draft/2020-12/schema",
	$id: "https://pbdb2.example.com/schemas/occurrence.json",
	title: "Occurrence",
	description: "An occurrence (a fossil found in a collection) as derived from its identifications",
	type: "object",
	readOnly: true,
	properties: occurrenceProperties,
	required: ["permid", "collection", "reference", "identification", "acceptedTaxon", "abundance"],
	unevaluatedProperties: false,
};

export default occurrenceSource;
