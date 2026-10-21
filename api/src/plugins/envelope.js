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
 */
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
