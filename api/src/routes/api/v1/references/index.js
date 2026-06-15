import { registerCrudRoutes } from '../../../../lib/crud-routes.js';

export default async function references(fastify) {
  registerCrudRoutes(fastify, {
    type: 'reference',
    stub: (permid = 'ref-00000000') => ({
      permid,
      publicationType: 'journal article',
      title: 'Stub reference',
      year: '2026',
    }),
  });
}
