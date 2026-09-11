import { hydrateLinkHrefs } from './link-hydration.js';
import { collectListFilters, rejectUnknownQuery } from './list-filters.js';
import { pageLinks } from './cursor.js';

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
 * READ-ONLY GROUPS (`readOnly: true`) expose GET only and answer every write
 * verb with 405 plus an `Allow` header. This is a property of the resource, not
 * of the current implementation state: `taxa` is derived output whose write
 * surface is the opinion tables, so its write verbs are refused rather than
 * stubbed. Further derived-table resources need no new factory work.
 *
 * @param {import('fastify').FastifyInstance} fastify
 * @param {object} opts
 * @param {string} opts.type   resource type label used in meta.type
 * @param {(permid?: string) => object} opts.stub  builds a stub record
 * @param {{ readHead: (permid: string) => Promise<object|null>, readHeads: (criteria?: object) => Promise<{ records: object[], hasMore: boolean }>, filters?: object }} [opts.repository]
 *   read repository; when omitted, reads use `stub`. `repository.filters` (when
 *   present) declares the field-filter query params this resource accepts.
 * @param {Record<string, import('./resource-tables.js').LinkDeclaration>} [opts.links]
 *   link enrichment config; when present, resolved links get an `href`
 * @param {Record<string, { type: 'boolean' }>} [opts.expansions]
 *   declared expansion params this resource's list accepts
 * @param {boolean} [opts.readOnly]  expose GET only; write verbs answer 405
 * @param {(record: object) => object} [opts.hydrate]
 *   override the default link hydration, for a group with extra hydration of
 *   its own (the taxa containing chain)
 */
export function registerCrudRoutes(
  fastify,
  { type, stub, repository, links, expansions, readOnly = false, hydrate: customHydrate },
) {
  const write = { preHandler: fastify.authenticate };
  // Each link's href base is derived from this group's mounted prefix and the
  // link's own target group, not hard-coded. A group with extra hydration of its
  // own (the taxa chain) supplies `hydrate` instead.
  const hydrate = customHydrate ?? ((record) => hydrateLinkHrefs(record, links, fastify.prefix));

  fastify.get('/', listReadHandler(fastify, { type, stub, repository, hydrate, expansions }));

  // Single read
  fastify.get('/:permid', async (request, reply) => {
    // A single read takes no filters and no pagination, so it recognizes no
    // query parameters at all — but it is validated on the same terms as a list,
    // so strictness does not differ by endpoint shape.
    rejectUnknownQuery(request.query, fastify.httpErrors);

    if (!repository) return reply.sendData(hydrate(stub(request.params.permid)), { type });

    const record = await repository.readHead(request.params.permid);
    if (!record) {
      throw fastify.httpErrors.notFound(`No ${type} with permid '${request.params.permid}'`);
    }
    return reply.sendData(hydrate(record), { type });
  });

  if (readOnly) {
    registerMethodNotAllowed(fastify, type);
    return;
  }

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

/** Verbs a read-only group refuses, and the methods it does permit. */
const WRITE_VERBS = ['POST', 'PUT', 'PATCH', 'DELETE'];
const READ_ONLY_ALLOW = 'GET, HEAD, OPTIONS';

/**
 * Register the write verbs of a read-only group as 405 Method Not Allowed.
 *
 * 405 rather than 404 (the resource plainly exists; it is the method that does
 * not apply) and rather than a stubbed 200 (which would advertise a write path
 * that can never exist — `taxa` is derived output, and taxonomy is written
 * through the opinion tables).
 *
 * The `authenticate` preHandler is deliberately NOT attached: there is no write
 * to authorize, and a refused method must never present as an authentication
 * failure. An unauthenticated caller and an authenticated one get the same 405.
 *
 * The `Allow` header is what makes this discoverable rather than merely a
 * refusal, and RFC 9110 requires it on a 405.
 *
 * @param {import('fastify').FastifyInstance} fastify
 * @param {string} type  resource type label, for the message
 */
function registerMethodNotAllowed(fastify, type) {
  for (const verb of WRITE_VERBS) {
    const handler = async (_request, reply) => {
      reply.header('Allow', READ_ONLY_ALLOW);
      // Via httpErrors so the body matches the 400/404 error shape exactly.
      throw fastify.httpErrors.methodNotAllowed(
        `The ${type} resource is read-only; ${verb} is not supported`,
      );
    };

    fastify.route({ method: verb, url: '/', handler });
    fastify.route({ method: verb, url: '/:permid', handler });
  }
}

/**
 * The shared list-read handler: the one place the `ids` read, field filters and
 * pagination are composed into a response. Both the uniform groups and the
 * `schemas` list use it, so the two cannot drift apart — `schemas` bypassing
 * this seam is exactly why it silently lacked `ids` and field filters before.
 *
 * `links.next`/`prev` default to null in the envelope and are set only where a
 * further page actually exists.
 *
 * @param {import('fastify').FastifyInstance} fastify
 * @param {{ type: string, stub: () => object,
 *   repository?: { readHeads: (criteria?: object) => Promise<{ records: object[], hasMore: boolean }>, filters?: object },
 *   hydrate: (record: object) => object }} opts
 */
export function listReadHandler(fastify, { type, stub, repository, hydrate, expansions }) {
  return async function listRead(request, reply) {
    const filters = collectListFilters(
      request.query,
      fastify.httpErrors,
      repository?.filters,
      expansions,
    );

    if (filters.ids) {
      // DB-backed: fetch the requested heads, narrowed by any field filters.
      // Stub fallback: echo each id back as a stub record (field filters can't
      // reach here — stub resources declare none — so the shape stays uniform).
      // An `ids` read is a single page by construction: it is capped at MAX_IDS
      // and the seam rejects `limit`/`cursor` alongside it, so both pagination
      // links stay null.
      const found = repository
        ? (
            await repository.readHeads({
              ids: filters.ids,
              fields: filters.fields,
              expansions: filters.expansions,
            })
          ).records
        : filters.ids.map((permid) => stub(permid));
      found.forEach(hydrate);

      // `requested`/`missing` is the pure multi-get's partial-success signal —
      // it answers "which of these ids have no current head?", which is only
      // well-defined when the id set is the sole constraint. A field filter turns
      // this into a filtered query, so the accounting is suppressed: `missing`
      // could not distinguish "no head" from "filtered out" (see design.md).
      if (!filters.fields) {
        const foundIds = new Set(found.map((record) => record.permid));
        const missing = filters.ids.filter((id) => !foundIds.has(id));
        return reply.sendList(found, {
          meta: { type, requested: filters.ids.length, missing },
        });
      }
      return reply.sendList(found, { meta: { type } });
    }

    // A stub resource has one record's worth of data, so it is its own single
    // page: it accepts the pagination params and reports no further pages.
    if (!repository) {
      const items = [stub()];
      items.forEach(hydrate);
      return reply.sendList(items, { meta: { type } });
    }

    const page = await repository.readHeads({
      fields: filters.fields,
      page: filters.page,
      expansions: filters.expansions,
    });
    page.records.forEach(hydrate);
    return reply.sendList(page.records, {
      meta: { type },
      links: pageLinks(request.url, page, filters.page.cursor),
    });
  };
}
