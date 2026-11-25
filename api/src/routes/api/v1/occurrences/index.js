/**
 * The `occurrences` resource: read-only, like `taxa`
 * (occurrence-reads; openspec/changes/add-occurrence-reads/design.md).
 *
 * `occurrences` is a derived cache (rebuild_occurrences()) of the
 * `identifications` ledger: one row per live occurrence, naming the
 * identification that currently wins. It is never written through the API, so
 * its write verbs answer 405. Reads go through `occurrence-repository.js`.
 *
 * Each occurrence's identifications are served under it, read-only (D1):
 *
 *   GET /occurrences/{permid}/identifications                 every current identification, root first
 *   GET /occurrences/{permid}/identifications/{permid}        one identification's full record
 *
 * There is no top-level `/identifications`: a root identification's permid is
 * also its occurrence's, so a top-level route would answer two resources for one
 * permid. The nested routes are not a route group, so they have no write verbs
 * at all (not 405s), and offer no CSV.
 *
 * There is NO STUB: a stub of two million fossils would be a fiction, so with no
 * database every read answers 503.
 */

import { registerCrudRoutes, listReadHandler, listRouteSchema, singleRouteSchema } from '../../../../lib/crud-routes.js';
import { occurrenceRepository } from '../../../../lib/occurrence-repository.js';
import { descriptorFor } from '../../../../lib/resource-tables.js';
import { addHref, groupBase, hydrateLinkHrefs, hydrateSourceLinks } from '../../../../lib/link-hydration.js';
import { occurrenceSource } from '../../../../../../payloadSchemas/occurrence.schema.js';
import { identificationSource } from '../../../../../../payloadSchemas/identification.schema.js';

const TYPE = 'occurrence';
const IDENTIFICATION_TYPE = 'identification';

const OCCURRENCE_PARAM = { type: 'string', description: 'The permid of the occurrence' };

const NESTED_LIST_PARAMS = {
  type: 'object',
  properties: { permid: OCCURRENCE_PARAM },
  required: ['permid'],
};

const NESTED_SINGLE_PARAMS = {
  type: 'object',
  properties: {
    permid: OCCURRENCE_PARAM,
    identificationPermid: { type: 'string', description: 'The permid of one of its identifications' },
  },
  required: ['permid', 'identificationPermid'],
};

export default async function occurrences(fastify) {
  const descriptor = descriptorFor('occurrences');
  const repository = occurrenceRepository(fastify);
  const { prefix, publicBaseUrl: base } = fastify;

  /** The URL of an identification's full record under its occurrence. */
  const identificationHref = (occurrencePermid, permid) =>
    `${base}${prefix}/${occurrencePermid}/identifications/${permid}`;

  // Links are hydrated at this boundary. The descriptor's links (collection,
  // reference, identification.reference, acceptedTaxon) go through
  // hydrateLinkHrefs; the identified taxon is not a descriptor link (D4), and the
  // embedded identification's own href points into this group's nested route.
  const hydrate = (record) => {
    hydrateLinkHrefs(record, descriptor.links, prefix, base);
    const { permid, ...rest } = record.identification;
    addHref(rest.taxon, base + groupBase(prefix, 'taxa'), 'taxa');
    record.identification = { permid, href: identificationHref(record.permid, permid), ...rest };
    return record;
  };

  const hydrateIdentification = (record) => hydrateSourceLinks(record, identificationSource, prefix, base);

  // Throws synchronously, so the shared handlers' `stub()` call surfaces as a
  // 503 through the normal error path rather than resolving to a stub record.
  const noDatabase = () => {
    throw fastify.httpErrors.serviceUnavailable(
      'The occurrences resource requires a PostgreSQL connection; none is configured',
    );
  };

  registerCrudRoutes(fastify, {
    type: TYPE,
    readOnly: true,
    repository,
    filters: descriptor.filters,
    component: 'Occurrence',
    hydrate,
    // CSV columns come from the read-only occurrence source, which describes this
    // read (occurrence reads do not go through merge(), so it is passed only here).
    formats: ['text/csv'],
    exportSource: occurrenceSource,
    stub: noDatabase,
  });

  const unknownOccurrence = (permid) => fastify.httpErrors.notFound(`No ${TYPE} with permid '${permid}'`);

  // The nested list follows list-pagination like every list (D6): the shared
  // handler, driven by the occurrence's own reader. An unknown occurrence is a 404.
  fastify.get(
    '/:permid/identifications',
    { schema: { params: NESTED_LIST_PARAMS, ...listRouteSchema({ component: 'Identification' }) } },
    async (request, reply) => {
      const { permid } = request.params;
      const nested = repository && {
        async readHeads(criteria) {
          const page = await repository.readIdentifications(permid, criteria);
          if (!page) throw unknownOccurrence(permid);
          return page;
        },
      };
      const handler = listReadHandler(fastify, {
        type: IDENTIFICATION_TYPE, stub: noDatabase, repository: nested, hydrate: hydrateIdentification,
      });
      return handler(request, reply);
    },
  );

  fastify.get(
    '/:permid/identifications/:identificationPermid',
    { schema: { ...singleRouteSchema({ component: 'Identification' }), params: NESTED_SINGLE_PARAMS } },
    async (request, reply) => {
      const { permid, identificationPermid } = request.params;
      if (!repository) noDatabase();
      const record = await repository.readIdentification(permid, identificationPermid);
      if (!record) {
        throw fastify.httpErrors.notFound(
          `No ${IDENTIFICATION_TYPE} with permid '${identificationPermid}' of ${TYPE} '${permid}'`,
        );
      }
      return reply.sendData(hydrateIdentification(record), { type: IDENTIFICATION_TYPE });
    },
  );
}
