import { registerCrudRoutes } from '../../../../lib/crud-routes.js';
import { repositoryForResource } from '../../../../lib/repository.js';

export default async function references(fastify) {
  registerCrudRoutes(fastify, {
    type: 'reference',
    repository: repositoryForResource(fastify, 'references'),
    stub: (permid = 'ref-00000000') => ({
      permid,
      publicationType: 'journal article',
      title: 'Stub reference',
      year: '2026',
    }),
  });
}
