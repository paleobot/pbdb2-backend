import { registerCrudRoutes } from '../../../../lib/crud-routes.js';

// Stub reads, though the table exists: hidden from the API description and
// discovery until they are real, since a documented stub is a false contract.
export default async function specimens(fastify) {
  registerCrudRoutes(fastify, {
    type: 'specimen',
    hidden: true,
    stub: (permid = 'spm-00000000') => ({
      permid,
      catalogNumber: 'STUB-001',
      repository: 'Stub Repository',
    }),
  });
}
