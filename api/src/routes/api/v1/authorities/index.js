import { registerCrudRoutes } from '../../../../lib/crud-routes.js';
import { repositoryForResource } from '../../../../lib/repository.js';

export default async function authorities(fastify) {
  registerCrudRoutes(fastify, {
    type: 'authority',
    repository: repositoryForResource(fastify, 'authorities'),
    stub: (permid = 'aut-00000000') => ({
      permid,
      taxonName: 'Stub taxon',
      rank: 'genus',
    }),
  });
}
