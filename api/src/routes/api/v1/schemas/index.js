/**
 * The `schemas` resource: uniform list and `ids` reads, and a single read that
 * is an AGGREGATE composing the schema with its nested characters and states
 * (see pbdb2-migrations/play/server.js for the shape this mirrors). So GET
 * /:permid is written explicitly instead of via the shared factory. Write
 * handling for nested characters/states is out of scope here.
 *
 * READS are DB-backed when a connection is present, and go through the generic
 * repository and `schemaSource`, as collections do: `primaryReference` and
 * `additionalReferences` come from `schemas.reference_id` and the
 * `additional_schema_refs` rows, and `href` is added by `hydrateSourceLinks`.
 * The list goes through the same shared list-filter seam as the uniform groups
 * (`ids`, pagination, declared field filters). The single read is the
 * repository's head (404 on a miss) plus its characters from schema-tree.js,
 * each node merged through its own source; the tree is deliberately NOT
 * paginated, since its characters and states are part of one resource. With no
 * DB configured, both fall back to the stubs below, which are in the sources'
 * shapes. Write verbs remain stubbed (a later change).
 */

import { repositoryForResource } from '../../../../lib/repository.js';
import { readSchemaCharacters } from '../../../../lib/schema-tree.js';
import { descriptorFor } from '../../../../lib/resource-tables.js';
import { hydrateSourceLinks } from '../../../../lib/link-hydration.js';
import { listReadHandler } from '../../../../lib/crud-routes.js';

const stubSchema = (permid = 'sch-00000000') => ({
  permid,
  title: 'Stub schema',
  year: '2026',
  primaryReference: { permid: 'ref-00000000', title: 'Stub reference' },
  additionalReferences: [],
});

const stubSchemaTree = (permid = 'sch-00000000') => ({
  ...stubSchema(permid),
  characters: [
    {
      permid: 'chr-00000000',
      name: 'Stub character',
      characters: [],
      states: [{ permid: 'stt-00000000', name: 'Stub state', quantitative: false, states: [] }],
    },
  ],
});

export default async function schemas(fastify) {
  const write = { preHandler: fastify.authenticate };
  const repository = repositoryForResource(fastify, 'schemas');
  const { source } = descriptorFor('schemas');
  const hydrate = (record) => hydrateSourceLinks(record, source, fastify.prefix);

  // List — flat heads through the shared seam (the tree shape is per-read)
  fastify.get(
    '/',
    listReadHandler(fastify, { type: 'schema', stub: stubSchema, repository, hydrate }),
  );

  // Single read — aggregate tree (schema -> characters -> states)
  fastify.get('/:permid', async (request, reply) => {
    if (!repository) {
      return reply.sendData(hydrate(stubSchemaTree(request.params.permid)), { type: 'schema' });
    }

    const head = await repository.readHead(request.params.permid);
    if (!head) {
      throw fastify.httpErrors.notFound(`No schema with permid '${request.params.permid}'`);
    }
    const characters = await readSchemaCharacters(fastify.pg, request.params.permid);
    return reply.sendData({ ...hydrate(head), characters }, { type: 'schema' });
  });

  // Create
  fastify.post('/', write, async (_request, reply) => {
    reply.code(201);
    return reply.sendData(hydrate(stubSchema()), { type: 'schema' });
  });

  // Full replace
  fastify.put('/:permid', write, async (request, reply) =>
    reply.sendData(hydrate(stubSchema(request.params.permid)), { type: 'schema' }),
  );

  // Partial update
  fastify.patch('/:permid', write, async (request, reply) =>
    reply.sendData(hydrate(stubSchema(request.params.permid)), { type: 'schema' }),
  );

  // Soft delete
  fastify.delete('/:permid', write, async (_request, reply) => reply.code(204).send());
}
