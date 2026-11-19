import { hydrateSourceLinks } from './link-hydration.js';
import { collectListFilters } from './list-filters.js';
import { listQuerySchema, SINGLE_QUERY_SCHEMA, PERMID_PARAMS_SCHEMA } from './query-schemas.js';
import { pageLinks } from './cursor.js';
import { singleEnvelope, listEnvelope } from '../plugins/envelope.js';
import { FORMATS, JSON_TYPE, negotiate } from './formats.js';
import { sendExport } from './export.js';

/** Marks a route the API description leaves out; discovery skips it too. */
const HIDDEN = { hide: true };

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
 * database; the write path is a separate, later change. They are hidden from
 * the API description, which documents only what a client can rely on.
 *
 * The GET routes declare their querystring (validated, query-schemas.js) and,
 * given a `component`, their 200 response (documentation only: responses are
 * not serialized through it).
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
 * @param {{ readHead: (permid: string) => Promise<object|null>, readHeads: (criteria?: object) => Promise<{ records: object[], hasMore: boolean }> }} [opts.repository]
 *   read repository; when omitted, reads use `stub`
 * @param {object} [opts.source]  annotated payload source; when present, its
 *   x-link properties and items get an `href`, and its inline enums are the
 *   legal values of filters on those fields
 * @param {Record<string, import('./resource-tables.js').FieldFilter>} [opts.filters]
 *   the descriptor's field filters: query params this resource's list accepts
 * @param {Record<string, { type: 'boolean' }>} [opts.expansions]
 *   declared expansion params this resource's list accepts
 * @param {string} [opts.component]  published schema (published-schemas.js) of
 *   one record, for the GET response schemas; omitted, they declare none
 * @param {boolean} [opts.hidden]  hide every route from the API description and
 *   discovery (a stub resource, `specimens`)
 * @param {boolean} [opts.readOnly]  expose GET only; write verbs answer 405
 * @param {(record: object) => object} [opts.hydrate]
 *   override the default link hydration, for a group with no payload source
 *   (taxa, whose descriptor links and containing chain hydrate themselves)
 * @param {string[]} [opts.formats]  non-JSON media types (formats.js) the list
 *   read offers (csv-output)
 * @param {string[]} [opts.singleFormats]  non-JSON media types the single read
 *   offers; none by default, and never CSV (references offer RIS; ris-output)
 * @param {object} [opts.exportSource]  the payload source a format's output is
 *   derived from; defaults to `source` (taxa, which has no `source`, passes
 *   `taxonSource`)
 */
export function registerCrudRoutes(
  fastify,
  {
    type, stub, repository, source, filters, expansions, component, hidden = false, readOnly = false,
    hydrate: customHydrate, formats = [], singleFormats = [], exportSource = source,
  },
) {
  const write = { preHandler: fastify.authenticate, schema: HIDDEN };
  // Each link's href base is derived from this group's mounted prefix and the
  // link's own target group, not hard-coded. A group with no source and no
  // `hydrate` of its own (specimens, a stub) has no links to hydrate.
  const hydrate = customHydrate ?? (source
    ? (record) => hydrateSourceLinks(record, source, fastify.prefix, fastify.publicBaseUrl)
    : (record) => record);

  const list = {
    schema: listRouteSchema({ filters, source, expansions, component, hidden, formats }),
    config: { formats },
  };
  fastify.get('/', list, listReadHandler(fastify, { type, stub, repository, hydrate, filters, expansions, formats, exportSource }));

  // Single read. It takes no filters and no pagination, so its schema recognizes
  // no query parameters — but it is validated on the same terms as a list, so
  // strictness does not differ by endpoint shape. A format it offers serves the
  // one record as that format's header and record (ris-output; design D3).
  const singleSerializers = buildSerializers(fastify, singleFormats, exportSource);
  const single = {
    schema: singleRouteSchema({ component, hidden, formats: singleFormats }),
    config: { formats: singleFormats },
  };
  fastify.get('/:permid', single, async (request, reply) => {
    const { permid } = request.params;
    let record;
    if (repository) {
      record = await repository.readHead(permid);
      if (!record) throw fastify.httpErrors.notFound(`No ${type} with permid '${permid}'`);
    } else {
      record = stub(permid);
    }
    record = hydrate(record);

    const mediaType = negotiate(request.headers.accept, singleFormats);
    if (mediaType === JSON_TYPE) return reply.sendData(record, { type });

    const format = FORMATS[mediaType];
    const serializer = singleSerializers[mediaType];
    reply
      .type(format.contentType)
      .header('Content-Disposition', `attachment; filename="${permid}.${format.extension}"`);
    return reply.send(request.method === 'HEAD' ? '' : serializer.header() + serializer.record(record));
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

    // Hidden from the description: it documents what a client can do.
    fastify.route({ method: verb, url: '/', schema: HIDDEN, handler });
    fastify.route({ method: verb, url: '/:permid', schema: HIDDEN, handler });
  }
}

/**
 * Each offered format's serializer, built once per route. `baseHref` is the
 * group's absolute URL, for a format that links back to the record (RIS's `UR`).
 */
function buildSerializers(fastify, formats, exportSource) {
  const baseHref = fastify.publicBaseUrl + fastify.prefix;
  return Object.fromEntries(formats.map((f) => [f, FORMATS[f].serializer(exportSource, { baseHref })]));
}

/** How the description words each non-JSON format a read offers. */
const FORMAT_DOCS = {
  'text/csv':
    'CSV, when `Accept` ranks `text/csv` above `application/json`. One header line, then one line per ' +
    'record. Without `limit` the response holds the whole result, streamed; with `limit` it is one page, ' +
    'and further pages are in the `Link` header. Columns come from the record schema: nested fields as ' +
    'dotted paths, array elements joined with `|` (an array inside one with `;`), and `\\`, `|` and `;` ' +
    'inside an element escaped with `\\`. A link gives its permid and label.',
  'application/x-research-info-systems':
    'RIS, for reference managers, when `Accept` ranks `application/x-research-info-systems` above ' +
    '`application/json`. One record per reference, from `TY` to `ER`, records separated by a blank line; ' +
    'UTF-8, CRLF line endings.',
};

/** A format's 200 content entry: a string, worded by FORMAT_DOCS. */
const formatContent = (formats) =>
  Object.fromEntries(formats.map((f) => [f, { schema: { type: 'string', description: FORMAT_DOCS[f] } }]));

/**
 * The schema of a list read: its querystring, from what the resource declares,
 * and its 200 response, a page of `component` records, plus the text of each
 * non-JSON format it offers.
 */
export function listRouteSchema({ filters, source, expansions, component, hidden = false, formats = [] }) {
  const json = component ? listEnvelope({ $ref: `${component}#` }) : undefined;
  let response;
  if (json && formats.length > 0) {
    response = {
      200: {
        description: `${json.description}; in another format, the whole result unless \`limit\` is sent`,
        content: {
          [JSON_TYPE]: { schema: json },
          ...formatContent(formats),
        },
      },
    };
  } else if (json) {
    response = { 200: json };
  }
  return {
    querystring: listQuerySchema({ filters, source, expansions }),
    ...(response ? { response } : {}),
    ...(hidden ? HIDDEN : {}),
  };
}

/**
 * The schema of a single read: its `permid`, no query parameters, one
 * `component` record, plus the text of each non-JSON format it offers.
 */
export function singleRouteSchema({ component, hidden = false, formats = [] }) {
  const json = component ? singleEnvelope({ $ref: `${component}#` }) : undefined;
  let response;
  if (json && formats.length > 0) {
    response = {
      200: {
        description: json.description,
        content: { [JSON_TYPE]: { schema: json }, ...formatContent(formats) },
      },
    };
  } else if (json) {
    response = { 200: json };
  }
  return {
    params: PERMID_PARAMS_SCHEMA,
    querystring: SINGLE_QUERY_SCHEMA,
    ...(response ? { response } : {}),
    ...(hidden ? HIDDEN : {}),
  };
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
 *   repository?: { readHeads: (criteria?: object) => Promise<{ records: object[], hasMore: boolean }> },
 *   hydrate: (record: object) => object, filters?: object, expansions?: object }} opts
 */
export function listReadHandler(
  fastify,
  { type, stub, repository, hydrate, filters: filterDefs, expansions, formats = [], exportSource },
) {
  // Each offered format's serializer, built once: its columns come from the schema.
  const serializers = buildSerializers(fastify, formats, exportSource);

  return async function listRead(request, reply) {
    const filters = collectListFilters(request.query, fastify.httpErrors, filterDefs, expansions);

    const mediaType = negotiate(request.headers.accept, formats);
    if (mediaType !== JSON_TYPE) {
      return sendExport(fastify, request, reply, {
        mediaType, serializer: serializers[mediaType], filters, repository, stub, hydrate,
      });
    }

    if (filters.ids) {
      // DB-backed: fetch the requested heads, narrowed by any field filters.
      // Stub fallback: echo each id back as a stub record, ignoring any field
      // filter (stub data cannot be filtered), so the shape stays uniform.
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
      links: pageLinks(request.url, page, filters.page.cursor, fastify.publicBaseUrl),
    });
  };
}
