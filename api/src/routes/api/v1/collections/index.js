import { registerCrudRoutes } from '../../../../lib/crud-routes.js';

export default async function collections(fastify) {
  registerCrudRoutes(fastify, {
    type: 'collection',
    stub: (permid = 'col-00000000') => ({
      permid,
      name: 'Stub collection',
      country: 'US',
      state: 'California',
    }),
  });
}
