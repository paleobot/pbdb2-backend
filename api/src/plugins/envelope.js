import fp from 'fastify-plugin';

/**
 * The standard PBDB2 response envelope: every successful response is
 * `{ data, meta, links }`. Centralizing it here is the single source of truth
 * for the shape, so it never drifts between resources.
 *
 * Rationale and the comparison against the legacy data1.2 envelope live in
 * docs/api-response-envelope-comparison.md.
 */
export default fp(async (fastify) => {
  /**
   * Single resource. `data` is an object identified by `permid`.
   * Reserves `meta.version` and the relationship `links` slots even when their
   * values are placeholders, so the shape is stable before DB integration.
   */
  fastify.decorateReply('sendData', function sendData(data, { type, meta = {}, links = {} } = {}) {
    return this.send({
      data,
      meta: {
        type,
        removed: false,
        version: { supersedes: null, supersededBy: null },
        ...meta,
      },
      links: {
        self: this.request.url,
        ...links,
      },
    });
  });

  /**
   * Collection. `data` is an array; `meta` carries result counts and `links`
   * reserves the pagination slots (`next` / `prev`). The pagination mechanism
   * (cursor vs offset) is deferred — only the slots are fixed here.
   */
  fastify.decorateReply('sendList', function sendList(items, { meta = {}, links = {} } = {}) {
    const data = Array.isArray(items) ? items : [];
    return this.send({
      data,
      meta: {
        found: data.length,
        returned: data.length,
        ...meta,
      },
      links: {
        self: this.request.url,
        next: null,
        prev: null,
        ...links,
      },
    });
  });

  /**
   * Index / discovery document. Same envelope, but `meta.type` is `index` and
   * the resource-specific `meta` fields (removed, version) are omitted — an
   * index node describes a path, not a stored record. `links` enumerates the
   * node's children (the discovery plugin supplies them).
   */
  fastify.decorateReply('sendIndex', function sendIndex(data, { links = {} } = {}) {
    return this.send({
      data,
      meta: { type: 'index' },
      links: {
        self: this.request.url,
        ...links,
      },
    });
  });
});
