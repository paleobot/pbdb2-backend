/**
 * The response schemas the API publishes: each payload source's `out` variant,
 * transformed for publication, plus the nesting the API itself composes (the
 * schema tree, the taxon containing chain). Fastify registers them as shared
 * schemas (app.js), route response schemas reference them as `'<Name>#'`, and
 * the OpenAPI document lists them under `components.schemas`.
 *
 * The transform:
 * - storage annotations go (`x-storage` with its codec, `x-variant`, `$schema`,
 *   `$id`): the storage layer does not leak into the API;
 * - a dictionary-backed property (`x-enumFrom`) is a string whose description
 *   names its vocabulary in words, since curators may add values (its table is
 *   not named, and its values are not listed: `out` does not enforce them);
 * - each `x-link` becomes a `$ref` to a generated `<Target>Link` component, kept
 *   nullable where `out` allows `null`.
 * No `x-` keyword is left.
 *
 * Responses are tested against these schemas, not raw `out`, so the transform is
 * itself under test. See openspec/changes/add-openapi-for-reads/design.md, D3–D5
 * and D9.
 */

import { deriveVariant } from '../../../payloadSchemas/lib/variants.js';
import { authoritySource } from '../../../payloadSchemas/authority.schema.js';
import { collectionSource } from '../../../payloadSchemas/collection.schema.js';
import { referenceSource } from '../../../payloadSchemas/reference.schema.js';
import { schemaSource } from '../../../payloadSchemas/schema.schema.js';
import { characterSource } from '../../../payloadSchemas/character.schema.js';
import { stateSource } from '../../../payloadSchemas/state.schema.js';
import { taxonSource } from '../../../payloadSchemas/taxon.schema.js';

/** A link target route group → the singular its component is named for. */
const LINK_TARGET_NAMES = { references: 'Reference', authorities: 'Authority', taxa: 'Taxon' };

/**
 * Each dictionary a published property draws from, in words. A new dictionary
 * needs an entry here, or publishing throws: the table name is not published.
 */
const VOCABULARIES = {
  admin0: 'ISO 3166-1 country codes',
  admin1: 'ISO 3166-2 subdivision codes',
  book_types: 'book types',
  collection_methods: 'collection methods',
  coordinate_bases: 'coordinate bases',
  dating_methods: 'dating methods',
  geographic_scales: 'geographic scales',
  languages: 'languages',
  lithologies: 'lithologies',
  lithology_adjectives: 'lithology adjectives',
  maritime: 'IHO sea area names',
  nomenclatural_statuses: 'nomenclatural statuses',
  notable_features: 'notable features',
  parts_preserved: 'parts preserved',
  preservation_modes: 'preservation modes',
  taxonomy_ranks: 'taxonomic ranks',
};

const STRIPPED = new Set(['$schema', '$id', 'x-storage', 'x-variant', 'x-enumFrom']);

const ref = (name) => ({ $ref: `${name}#` });
const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });
const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** A schema's description with a sentence appended. */
const describe = (node, sentence) => (node.description ? `${node.description}. ${sentence}` : sentence);

/**
 * Publish one schema node and everything under it. Each link met is recorded in
 * `links` (target → its component) and replaced by a reference to it.
 */
function publishNode(node, links) {
  if (Array.isArray(node)) return node.map((n) => publishNode(n, links));
  if (!isObject(node)) return node;
  if (node['x-link']) return linkReference(node, links);

  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (!STRIPPED.has(key)) out[key] = publishNode(value, links);
  }
  if (node['x-enumFrom']) {
    const vocabulary = VOCABULARIES[node['x-enumFrom'].table];
    if (!vocabulary) throw new Error(`No published name for the dictionary '${node['x-enumFrom'].table}'`);
    out.description = describe(node, `A term from the ${vocabulary} vocabulary; curators may add terms, so the values are not listed`);
  }
  return out;
}

/** Replace a link node with a reference to its target's component, recording the component. */
function linkReference(node, links) {
  const { target, label } = node['x-link'];
  const name = LINK_TARGET_NAMES[target];
  if (!name) throw new Error(`No published name for the link target '${target}'`);

  const known = links.get(target);
  if (known && known.label !== label) {
    throw new Error(`Links to '${target}' are declared with two labels: '${known.label}' and '${label}'`);
  }
  if (!known) {
    const { properties, required, additionalProperties } = node;
    links.set(target, {
      label,
      schema: {
        $id: `${name}Link`,
        type: 'object',
        description:
          `A link to a ${name.toLowerCase()}: its \`permid\`, its \`${label}\`, and \`href\`, ` +
          `its read URL (\`…/api/v1/${target}/{permid}\`).`,
        properties: publishNode(properties, links),
        required,
        additionalProperties,
      },
    });
  }

  const link = Array.isArray(node.type) && node.type.includes('null') ? nullable(ref(`${name}Link`)) : ref(`${name}Link`);
  return node.description ? { description: node.description, ...link } : link;
}

/** A source's `out` variant, published, under the component name `$id`. */
function publishSource(source, links) {
  return { $id: source.title, ...publishNode(deriveVariant(source, 'out'), links) };
}

const arrayOf = (name, description) => ({ type: 'array', items: ref(name), description });

/**
 * Every published component, links first. Built fresh on each call, so callers
 * may not share mutations.
 *
 * @returns {object[]} schemas, each with its component name as `$id`
 */
export function publishedComponents() {
  const links = new Map();
  const [collection, reference, authority, schema, character, state, taxon] = [
    collectionSource, referenceSource, authoritySource, schemaSource, characterSource, stateSource, taxonSource,
  ].map((source) => publishSource(source, links));

  // The schema tree (lib/schema-tree.js): a single read adds `characters`, each
  // character nests characters and states, each state nests states.
  schema.properties.characters = arrayOf('Character', "The schema's characters, nested. Present on a single read only");
  character.properties.characters = arrayOf('Character', 'Child characters, in order');
  character.properties.states = arrayOf('State', "The character's states, in order");
  character.required = [...(character.required ?? []), 'characters', 'states'];
  state.properties.states = arrayOf('State', 'Child states, in order');
  state.required = [...(state.required ?? []), 'states'];

  // The taxon containing chain (lib/taxa-repository.js): the immediate
  // container first, each nesting the next one root-ward, the root's chain null.
  const chain = {
    description: 'The containing taxa, immediate container first; null at the root',
    ...nullable(ref('ContainingTaxon')),
  };
  taxon.properties.containingTaxa = {
    ...chain,
    description: `${chain.description}. Always present on a single read; on a list, only with \`includeContainingTaxa=true\``,
  };
  const { permid, name, rank } = taxon.properties;
  const containingTaxon = {
    $id: 'ContainingTaxon',
    type: 'object',
    description: 'A taxon in a classification chain',
    properties: {
      permid,
      name,
      rank,
      href: { type: 'string', description: 'read URL of this taxon' },
      containingTaxa: chain,
    },
    required: ['permid', 'name', 'rank', 'href', 'containingTaxa'],
    additionalProperties: false,
  };

  return [
    ...[...links.values()].map((link) => link.schema),
    collection, reference, authority, schema, character, state, taxon, containingTaxon,
  ];
}
