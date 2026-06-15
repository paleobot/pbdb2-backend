import fp from 'fastify-plugin';

/**
 * Hypermedia discovery for the API base paths.
 *
 * `/`, `/api`, and `/api/v1` would otherwise 404. Instead they return an index
 * document (the standard `{ data, meta, links }` envelope, `meta.type` =
 * `index`) whose `links` enumerate the node's immediate children.
 *
 * The child links are DERIVED from the registered route tree, not hardcoded:
 * for a base path, the links are the distinct next path-segments of every route
 * registered beneath it. Drop a new resource (or a future API version) folder
 * and it appears here automatically — same directory-is-the-config philosophy
 * as the autoloaded `/api/v1` prefix.
 */

const BASE_PATHS = ['/', '/api', '/api/v1'];

const NODE_DATA = {
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

function buildLinks(base, urls) {
  const links = { self: base };
  for (const segment of childSegments(base, urls)) {
    links[segment] = base === '/' ? `/${segment}` : `${base}/${segment}`;
  }
  return links;
}

export default fp(async (fastify) => {
  const urls = new Set();
  const linkMaps = {};

  // Collect every registered route path. Added before routes autoload, on the
  // root instance, so it captures all resource routes.
  fastify.addHook('onRoute', (route) => {
    urls.add(route.url);
  });

  // The route table is fixed once the app is ready, so build the link maps once
  // rather than walking routes on every request.
  fastify.addHook('onReady', async () => {
    for (const base of BASE_PATHS) {
      linkMaps[base] = buildLinks(base, urls);
    }
  });

  for (const base of BASE_PATHS) {
    fastify.get(base, async (_request, reply) =>
      reply.sendIndex(NODE_DATA[base], { links: linkMaps[base] }),
    );
  }
});
