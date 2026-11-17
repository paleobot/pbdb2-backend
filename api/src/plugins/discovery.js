import fp from 'fastify-plugin';

import { INDEX_ENVELOPE } from './envelope.js';
import { SINGLE_QUERY_SCHEMA } from '../lib/query-schemas.js';

/**
 * Hypermedia discovery for the API base paths.
 *
 * `/`, `/api`, and `/api/v1` would otherwise 404. Instead they return an index
 * document (the standard `{ data, meta, links }` envelope, `meta.type` =
 * `index`). Its `data` describes the node and lists the node's immediate
 * children in `data.resources`, each `{ href }` (an object, so fields such as a
 * description can be added beside `href` without breaking clients). Its `links`
 * holds only registered link relations, never a child's name.
 *
 * The children are DERIVED from the registered route tree, not hardcoded: for a
 * base path, they are the distinct next path-segments of every route
 * registered beneath it. Drop a new resource (or a future API version) folder
 * and it appears here automatically — same directory-is-the-config philosophy
 * as the autoloaded `/api/v1` prefix.
 *
 * A route hidden from the API description (`schema.hide`) is absent here too:
 * a segment is listed when any non-hidden route lies under it, so hiding a
 * group's stub writes keeps the group, and hiding all of `specimens` drops it.
 * The description itself (`openapi.json`, `docs`) is hidden, and the version's
 * index links it by the relations RFC 8631 defines for it: `service-desc` (the
 * OpenAPI document) and `service-doc` (its human-readable viewer).
 */

const BASE_PATHS = ['/', '/api', '/api/v1'];

/** The API description of a version, linked from that version's index only. */
const DESCRIPTION_LINKS = {
  '/api/v1': { 'service-desc': '/api/v1/openapi.json', 'service-doc': '/api/v1/docs' },
};

export const NODE_DATA = {
  '/': { name: 'PBDB2 API', description: 'Paleobiology Database REST API' },
  '/api': { name: 'PBDB2 API', description: 'Available API versions' },
  '/api/v1': {
    name: 'PBDB2 API',
    version: 'v1',
    description: 'Paleobiology Database REST API, version 1',
  },
};

/** Distinct immediate child segments of `base` across all registered route urls. */
function childSegments(base, urls) {
  const prefix = base === '/' ? '/' : `${base}/`;
  const segments = new Set();
  for (const url of urls) {
    if (!url.startsWith(prefix)) continue;
    const segment = url.slice(prefix.length).split('/')[0];
    if (!segment || segment.startsWith(':')) continue; // skip self and :params
    segments.add(segment);
  }
  return [...segments].sort();
}

/**
 * The index of a base path: its children as `data.resources` and its relations
 * as `links`, every URL the public base URL followed by the path.
 */
function buildIndex(base, urls, publicBaseUrl) {
  const resources = {};
  for (const segment of childSegments(base, urls)) {
    resources[segment] = { href: publicBaseUrl + (base === '/' ? `/${segment}` : `${base}/${segment}`) };
  }
  const links = { self: publicBaseUrl + base };
  for (const [rel, path] of Object.entries(DESCRIPTION_LINKS[base] ?? {})) {
    links[rel] = publicBaseUrl + path;
  }
  return { data: { ...NODE_DATA[base], resources }, links };
}

export default fp(async (fastify) => {
  const urls = new Set();
  const indexes = {};

  // Collect every registered route path that the description documents. Added
  // before routes autoload, on the root instance, so it captures all resource
  // routes.
  fastify.addHook('onRoute', (route) => {
    if (!route.schema?.hide) urls.add(route.url);
  });

  // The route table is fixed once the app is ready, so build the indexes once
  // rather than walking routes on every request.
  fastify.addHook('onReady', async () => {
    for (const base of BASE_PATHS) {
      indexes[base] = buildIndex(base, urls, fastify.publicBaseUrl);
    }
  });

  const schema = { querystring: SINGLE_QUERY_SCHEMA, response: { 200: INDEX_ENVELOPE } };
  for (const base of BASE_PATHS) {
    fastify.get(base, { schema }, async (_request, reply) =>
      reply.sendIndex(indexes[base].data, { links: indexes[base].links }),
    );
  }
}, { name: 'discovery', dependencies: ['openapi'] });
