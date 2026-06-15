/**
 * The `schemas` resource is the deliberate exception to the uniform CRUD
 * pattern: its single-read representation is an AGGREGATE that composes the
 * schema with its nested characters and states (see
 * pbdb2-migrations/play/server.js for the shape this mirrors), rather than a
 * flat record. So GET /:permid is written explicitly instead of via the shared
 * factory. Write handling for nested characters/states is out of scope here.
 *
 * READS are DB-backed when a connection is present: the list uses the generic
 * head-read repository; the single read assembles the tree via schema-tree.js
 * (404 on a miss). With no DB configured, both fall back to the stubs below.
 * Write verbs remain stubbed (a later change).
 */

import { repositoryForResource } from '../../../../lib/repository.js';
import { readSchemaTree } from '../../../../lib/schema-tree.js';

const stubSchema = (permid = 'sch-00000000') => ({
  permid,
  title: 'Stub schema',
  year: '2026',
});

const stubSchemaTree = (permid = 'sch-00000000') => ({
  ...stubSchema(permid),
  characters: [
    {
      permid: 'chr-00000000',
      name: 'Stub character',
      states: [{ permid: 'stt-00000000', name: 'Stub state', states: [] }],
      characters: [],
    },
  ],
});

export default async function schemas(fastify) {
  const write = { preHandler: fastify.authenticate };
  const repository = repositoryForResource(fastify, 'schemas');

  // List — flat heads via the generic repository (the tree shape is per-read)
  fastify.get('/', async (_request, reply) => {
    const items = repository ? await repository.list() : [stubSchema()];
    return reply.sendList(items, { meta: { type: 'schema' } });
  });

  // Single read — aggregate tree (schema -> characters -> states)
  fastify.get('/:permid', async (request, reply) => {
    if (!repository) {
      return reply.sendData(stubSchemaTree(request.params.permid), { type: 'schema' });
    }

    const tree = await readSchemaTree(fastify.pg, request.params.permid);
    if (!tree) {
      throw fastify.httpErrors.notFound(`No schema with permid '${request.params.permid}'`);
    }
    return reply.sendData(tree, { type: 'schema' });
  });

  // Create
  fastify.post('/', write, async (_request, reply) => {
    reply.code(201);
    return reply.sendData(stubSchema(), { type: 'schema' });
  });

  // Full replace
  fastify.put('/:permid', write, async (request, reply) =>
    reply.sendData(stubSchema(request.params.permid), { type: 'schema' }),
  );

  // Partial update
  fastify.patch('/:permid', write, async (request, reply) =>
    reply.sendData(stubSchema(request.params.permid), { type: 'schema' }),
  );

  // Soft delete
  fastify.delete('/:permid', write, async (_request, reply) => reply.code(204).send());
}
