import { registerCrudRoutes } from '../../../../lib/crud-routes.js';
import { repositoryForResource } from '../../../../lib/repository.js';

export default async function collections(fastify) {
  registerCrudRoutes(fastify, {
    type: 'collection',
    repository: repositoryForResource(fastify, 'collections'),
    stub: (permid = 'col-00000000') => ({
      permid,
      name: 'Stub collection',
      country: 'US',
      state: 'California',
    }),
  });
}
