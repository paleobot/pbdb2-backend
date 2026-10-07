import { registerCrudRoutes } from '../../../../lib/crud-routes.js';
import { repositoryForResource } from '../../../../lib/repository.js';
import { descriptorFor } from '../../../../lib/resource-tables.js';

export default async function authorities(fastify) {
  registerCrudRoutes(fastify, {
    type: 'authority',
    repository: repositoryForResource(fastify, 'authorities'),
    source: descriptorFor('authorities').source,
    // A payload in the authority source's shape, as a merged read returns it.
    stub: (permid = 'aut-00000000') => ({
      permid,
      legacyIDs: { oldpbdbIDs: [] },
      citation: 'Stub authority',
      descriptors: [],
      publishedInReference: false,
      reference: { permid: 'ref-00000000', title: 'Stub reference' },
    }),
  });
}
