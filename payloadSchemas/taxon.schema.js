/*
 * Annotated source for the taxon: the API's read of the derived `taxa` table.
 * Annotations are described in collection.schema.js.
 *
 * A taxon is derived output (rebuild_taxa_full()), never written through the
 * API, so the source is read-only at its root: deriveVariant refuses in-create
 * and patch-guard for it (payloadSchemas/lib/variants.js). Nothing is stored as
 * jsonb, so every property carries x-storage naming its `taxa` column and the db
 * variant is an empty object.
 *
 * Taxa reads do not go through merge(): api/src/lib/taxa-repository.js reads
 * these columns directly, tuned for classification paths. The x-storage here is
 * descriptive, and the API's taxa conformance tests keep it true. The
 * containingTaxa chain is an expansion the API composes, not part of the source.
 */
import { link } from "./lib/links.js";

const taxonProperties = {
	permid: {
		type: "string",
		readOnly: true,
		"x-storage": { column: "permid" },
		description: "Permanent identifier of this name as spelled"
	},
	name: {
		type: "string",
		readOnly: true,
		"x-storage": { column: "name" }
	},
	rank: {
		type: "string",
		readOnly: true,
		"x-storage": { column: "rank_id" },
		"x-enumFrom": { table: "taxonomy_ranks", column: "taxonomy_rank" }
	},
	nomenclaturalStatus: {
		type: ["string", "null"],
		readOnly: true,
		"x-storage": { column: "nomenclatural_status_id" },
		"x-enumFrom": { table: "nomenclatural_statuses", column: "status" }
	},
	authority: {
		...link({ target: "authorities", label: "citation" }),
		"x-storage": { column: "authority_id" },
		description: "the authority this name was established by"
	},
	accepted: {
		...link({ target: "taxa", label: "name" }),
		"x-storage": { column: "concept_permid" },
		description: "the accepted name of the concept this name belongs to"
	}
};

export const taxonSource = {
	$schema: "https://json-schema.org/draft/2020-12/schema",
	$id: "https://pbdb2.example.com/schemas/taxon.json",
	title: "Taxon",
	description: "A taxon as derived from the taxonomic opinions",
	type: "object",
	readOnly: true,
	properties: taxonProperties,
	required: ["permid", "name", "rank", "nomenclaturalStatus", "authority", "accepted"],
	unevaluatedProperties: false,
};

export default taxonSource;
