import { registerCrudRoutes } from '../../../../lib/crud-routes.js';
import { repositoryForResource } from '../../../../lib/repository.js';
import { descriptorFor } from '../../../../lib/resource-tables.js';

export default async function references(fastify) {
  registerCrudRoutes(fastify, {
    type: 'reference',
    repository: repositoryForResource(fastify, 'references'),
    source: descriptorFor('references').source,
    // A payload in the reference source's shape, as a merged read returns it.
    stub: (permid = 'ref-00000000') => ({
      permid,
      publicationType: 'journal article',
      title: 'Stub reference',
      publicationYear: '2026',
    }),
  });
}
