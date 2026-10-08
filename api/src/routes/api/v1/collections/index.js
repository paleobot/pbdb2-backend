import { registerCrudRoutes } from '../../../../lib/crud-routes.js';
import { repositoryForResource } from '../../../../lib/repository.js';
import { descriptorFor } from '../../../../lib/resource-tables.js';

export default async function collections(fastify) {
  registerCrudRoutes(fastify, {
    type: 'collection',
    repository: repositoryForResource(fastify, 'collections'),
    source: descriptorFor('collections').source,
    // A payload in the collection source's shape, as a merged read returns it.
    stub: (permid = 'col-00000000') => ({
      permid,
      name: 'Stub collection',
      location: {
        toponym: { administrativeArea: { admin0: 'US', admin1: 'US-CA' } },
        scale: 'outcrop',
      },
      primaryReference: { permid: 'ref-00000000', title: 'Stub reference' },
      additionalReferences: [],
    }),
  });
}
