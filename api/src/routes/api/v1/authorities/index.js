import { registerCrudRoutes } from '../../../../lib/crud-routes.js';

export default async function authorities(fastify) {
  registerCrudRoutes(fastify, {
    type: 'authority',
    stub: (permid = 'aut-00000000') => ({
      permid,
      taxonName: 'Stub taxon',
      rank: 'genus',
    }),
  });
}
