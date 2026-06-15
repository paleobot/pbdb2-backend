/**
 * Registers the uniform CRUD verb coverage shared by references, authorities,
 * collections, and specimens. Each is permid-keyed and returns stubbed data in
 * the standard envelope. Write verbs are guarded by the (stubbed) authenticate
 * seam; reads are open.
 *
 * Handlers return canned data — no database access. Wiring the DB later changes
 * the data source, not the response shape.
 *
 * @param {import('fastify').FastifyInstance} fastify
 * @param {object} opts
 * @param {string} opts.type   resource type label used in meta.type
 * @param {(permid?: string) => object} opts.stub  builds a stub record
 */
export function registerCrudRoutes(fastify, { type, stub }) {
  const write = { preHandler: fastify.authenticate };

  // List
  fastify.get('/', async (_request, reply) => reply.sendList([stub()], { meta: { type } }));

  // Single read
  fastify.get('/:permid', async (request, reply) =>
    reply.sendData(stub(request.params.permid), { type }),
  );

  // Create
  fastify.post('/', write, async (_request, reply) => {
    reply.code(201);
    return reply.sendData(stub(), { type });
  });

  // Full replace
  fastify.put('/:permid', write, async (request, reply) =>
    reply.sendData(stub(request.params.permid), { type }),
  );

  // Partial update
  fastify.patch('/:permid', write, async (request, reply) =>
    reply.sendData(stub(request.params.permid), { type }),
  );

  // Soft delete
  fastify.delete('/:permid', write, async (_request, reply) => reply.code(204).send());
}
