import { registerCrudRoutes } from '../../../../lib/crud-routes.js';
import { repositoryForResource } from '../../../../lib/repository.js';
import { descriptorFor } from '../../../../lib/resource-tables.js';

export default async function authorities(fastify) {
  registerCrudRoutes(fastify, {
    type: 'authority',
    repository: repositoryForResource(fastify, 'authorities'),
    references: descriptorFor('authorities').references,
    stub: (permid = 'aut-00000000') => ({
      permid,
      taxonName: 'Stub taxon',
      rank: 'genus',
      reference: { title: 'Stub reference', permid: 'ref-00000000' },
    }),
  });
}
