import { registerCrudRoutes } from '../../../../lib/crud-routes.js';
import { repositoryForResource } from '../../../../lib/repository.js';
import { descriptorFor } from '../../../../lib/resource-tables.js';

export default async function collections(fastify) {
  registerCrudRoutes(fastify, {
    type: 'collection',
    repository: repositoryForResource(fastify, 'collections'),
    references: descriptorFor('collections').references,
    stub: (permid = 'col-00000000') => ({
      permid,
      name: 'Stub collection',
      country: 'US',
      state: 'California',
      primaryReference: { title: 'Stub reference', permid: 'ref-00000000' },
      additionalReferences: [],
    }),
  });
}
