import { referencesBase, hydrateReferenceHrefs } from './reference-hydration.js';
import { collectListFilters } from './list-filters.js';

/**
 * Registers the uniform CRUD verb coverage shared by references, authorities,
 * collections, and specimens. Each is permid-keyed and returns data in the
 * standard envelope. Write verbs are guarded by the (stubbed) authenticate
 * seam; reads are open.
 *
 * READS: when a `repository` is supplied, GET list/single read real
 * version-chained data from PostgreSQL (single-read miss → 404). When it is
 * absent (e.g. `specimens`, which has no backing table, or any build with no DB
 * configured), reads fall back to `stub` — preserving the pre-DB behavior.
 *
 * WRITES (POST/PUT/PATCH/DELETE) still return `stub` data and do NOT touch the
 * database; the write path is a separate, later change.
 *
 * @param {import('fastify').FastifyInstance} fastify
 * @param {object} opts
 * @param {string} opts.type   resource type label used in meta.type
 * @param {(permid?: string) => object} opts.stub  builds a stub record
 * @param {{ readHead: (permid: string) => Promise<object|null>, list: () => Promise<object[]> }} [opts.repository]
 *   read repository; when omitted, reads use `stub`
 * @param {import('./resource-tables.js').ReferenceConfig} [opts.references]
 *   reference enrichment config; when present, resolved references get an `href`
 */
export function registerCrudRoutes(fastify, { type, stub, repository, references }) {
  const write = { preHandler: fastify.authenticate };
  // Derived once from this group's mounted prefix, not hard-coded.
  const refsBase = referencesBase(fastify.prefix);
  const hydrate = (record) => hydrateReferenceHrefs(record, references, refsBase);

  // List — and, when an `ids` filter is present, the multi-entity read. Both
  // return the list envelope; only `/:permid` is singular.
  fastify.get('/', async (request, reply) => {
    const filters = collectListFilters(request.query, fastify.httpErrors);

    if (filters.ids) {
      // DB-backed: fetch the requested heads. Stub fallback: echo each id back
      // as a stub record (so the shape matches the DB-backed path).
      const found = repository
        ? await repository.readHeads(filters.ids)
        : filters.ids.map((permid) => stub(permid));
      found.forEach(hydrate);

      // Partial-success accounting is computed here, at the route boundary,
      // against the requested set — the repository stays HTTP-agnostic.
      const foundIds = new Set(found.map((record) => record.permid));
      const missing = filters.ids.filter((id) => !foundIds.has(id));
      return reply.sendList(found, {
        meta: { type, requested: filters.ids.length, missing },
      });
    }

    const items = repository ? await repository.list() : [stub()];
    items.forEach(hydrate);
    return reply.sendList(items, { meta: { type } });
  });

  // Single read
  fastify.get('/:permid', async (request, reply) => {
    if (!repository) return reply.sendData(hydrate(stub(request.params.permid)), { type });

    const record = await repository.readHead(request.params.permid);
    if (!record) {
      throw fastify.httpErrors.notFound(`No ${type} with permid '${request.params.permid}'`);
    }
    return reply.sendData(hydrate(record), { type });
  });

  // Create
  fastify.post('/', write, async (_request, reply) => {
    reply.code(201);
    return reply.sendData(hydrate(stub()), { type });
  });

  // Full replace
  fastify.put('/:permid', write, async (request, reply) =>
    reply.sendData(hydrate(stub(request.params.permid)), { type }),
  );

  // Partial update
  fastify.patch('/:permid', write, async (request, reply) =>
    reply.sendData(hydrate(stub(request.params.permid)), { type }),
  );

  // Soft delete
  fastify.delete('/:permid', write, async (_request, reply) => reply.code(204).send());
}
