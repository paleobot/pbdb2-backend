import { registerCrudRoutes } from '../../../../lib/crud-routes.js';

export default async function specimens(fastify) {
  registerCrudRoutes(fastify, {
    type: 'specimen',
    stub: (permid = 'spm-00000000') => ({
      permid,
      catalogNumber: 'STUB-001',
      repository: 'Stub Repository',
    }),
  });
}
