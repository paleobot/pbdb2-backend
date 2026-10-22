import fp from 'fastify-plugin';

/**
 * The standard PBDB2 response envelope: every successful response is
 * `{ data, meta, links }`. Centralizing it here is the single source of truth
 * for the shape, so it never drifts between resources.
 *
 * Every `links.self` is absolute: the app's public base URL (`build()`'s
 * `publicBaseUrl`) followed by the request's path and query as received.
 *
 * Rationale and the comparison against the legacy data1.2 envelope live in
 * docs/api-response-envelope-comparison.md.
 *
 * The schemas below describe what the three decorators produce, for route
 * response schemas and so the API description. They document; they do not
 * serialize (app.js), so tests keep them true.
 */

const url = { type: 'string', description: 'absolute URL' };
const pageLink = { anyOf: [url, { type: 'null' }] };

/** A single resource: `data` is the resource, `meta` its type, `links` its own URL. */
export function singleEnvelope(dataSchema) {
  return {
    description: 'The resource',
    type: 'object',
    properties: {
      data: dataSchema,
      meta: { type: 'object', properties: { type: { type: 'string' } }, required: ['type'], additionalProperties: false },
      links: { type: 'object', properties: { self: url }, required: ['self'], additionalProperties: false },
    },
    required: ['data', 'meta', 'links'],
    additionalProperties: false,
  };
}

/**
 * A list: `data` is one page of items. `requested` and `missing` appear on a pure
 * `ids` read (no field filter), saying which requested permids have no current
 * head. `next` / `prev` are null where no further page exists.
 */
export function listEnvelope(itemSchema) {
  return {
    description: 'One page of resources, in permid order',
    type: 'object',
    properties: {
      data: { type: 'array', items: itemSchema },
      meta: {
        type: 'object',
        properties: {
          returned: { type: 'integer', minimum: 0, description: 'Items on this page' },
          type: { type: 'string' },
          requested: { type: 'integer', minimum: 1, description: 'Distinct permids an `ids` read asked for' },
          missing: {
            type: 'array',
            items: { type: 'string' },
            description: 'Requested permids with no current, non-removed record',
          },
        },
        required: ['returned', 'type'],
        additionalProperties: false,
      },
      links: {
        type: 'object',
        properties: { self: url, next: pageLink, prev: pageLink },
        required: ['self', 'next', 'prev'],
        additionalProperties: false,
      },
    },
    required: ['data', 'meta', 'links'],
    additionalProperties: false,
  };
}

/** An index document: `data` describes the node, `links` its children by name. */
export const INDEX_ENVELOPE = {
  description: 'An index document',
  type: 'object',
  properties: {
    data: {
      type: 'object',
      properties: { name: { type: 'string' }, version: { type: 'string' }, description: { type: 'string' } },
      required: ['name', 'description'],
      additionalProperties: false,
    },
    meta: { type: 'object', properties: { type: { const: 'index' } }, required: ['type'], additionalProperties: false },
    links: {
      type: 'object',
      properties: { self: url },
      required: ['self'],
      additionalProperties: url,
      description: '`self`, then one entry per child path; the version index also has `describedby` (this document) and `docs`',
    },
  },
  required: ['data', 'meta', 'links'],
  additionalProperties: false,
};

export default fp(async (fastify) => {
  /**
   * Single resource. `data` is an object identified by `permid`; `meta` is its
   * `type`. No placeholders: a read serves only a current, non-removed head, so
   * `removed` and `version` could only be constants. Version fields return with
   * the `/versions` sub-resource. Relationships are inline links in `data`, not
   * `links` entries.
   */
  fastify.decorateReply('sendData', function sendData(data, { type, meta = {}, links = {} } = {}) {
    return this.send({
      data,
      meta: {
        type,
        ...meta,
      },
      links: {
        self: this.server.publicBaseUrl + this.request.url,
        ...links,
      },
    });
  });

  /**
   * Collection. `data` is an array; `meta.returned` counts this page (counts are
   * page-scoped: no total is computed). `links.next` / `prev` default to null;
   * the list handler sets them where a further page exists.
   */
  fastify.decorateReply('sendList', function sendList(items, { meta = {}, links = {} } = {}) {
    const data = Array.isArray(items) ? items : [];
    return this.send({
      data,
      meta: {
        returned: data.length,
        ...meta,
      },
      links: {
        self: this.server.publicBaseUrl + this.request.url,
        next: null,
        prev: null,
        ...links,
      },
    });
  });

  /**
   * Index / discovery document. Same envelope, but `meta.type` is `index`: an
   * index node describes a path, not a stored record. `links` enumerates the
   * node's children (the discovery plugin supplies them).
   */
  fastify.decorateReply('sendIndex', function sendIndex(data, { links = {} } = {}) {
    return this.send({
      data,
      meta: { type: 'index' },
      links: {
        self: this.server.publicBaseUrl + this.request.url,
        ...links,
      },
    });
  });
});
