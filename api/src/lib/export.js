/**
 * A list read in a non-JSON format (csv-output; design D6–D11).
 *
 * The record source and the serializer are separate: this module reads
 * hydrated records (one page, an `ids` set, or every batch of the whole
 * result) and the format's serializer turns them into text. A new format adds
 * a serializer to the registry (formats.js) and reuses everything here.
 *
 * - `ids`: the found records; no `Link`.
 * - `limit` sent: one page, as in JSON; further pages in a `Link` header.
 * - neither: the whole result, streamed in forward batches of MAX_LIMIT, under
 *   the instance's export cap. The first batch is read before the response
 *   starts, so a failure there is an ordinary JSON error; a later failure
 *   destroys the stream, which aborts the connection.
 */

import { posix } from 'node:path';
import { Readable } from 'node:stream';

import { FORMATS } from './formats.js';
import { MAX_LIMIT } from './list-filters.js';
import { BACKWARD, FORWARD, pageLinks } from './cursor.js';

/** Seconds a client over the export cap is asked to wait. */
const RETRY_AFTER = 30;

/**
 * Send a list read as `mediaType`.
 *
 * @param {import('fastify').FastifyInstance} fastify
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} reply
 * @param {object} opts
 * @param {string} opts.mediaType   a key of FORMATS
 * @param {{ header: () => string, record: (r: object) => string }} opts.serializer
 * @param {object} opts.filters     collectListFilters output
 * @param {object} [opts.repository]
 * @param {(permid?: string) => object} opts.stub
 * @param {(record: object) => object} opts.hydrate
 */
export async function sendExport(fastify, request, reply, { mediaType, serializer, filters, repository, stub, hydrate }) {
  const format = FORMATS[mediaType];

  const expansion = Object.entries(filters.expansions ?? {}).find(([, on]) => on);
  if (expansion) {
    throw fastify.httpErrors.badRequest(`\`${expansion[0]}\` is not available as ${mediaType}`);
  }

  const bounded = filters.ids || 'limit' in request.query || !repository;
  const cursor = filters.page.cursor;
  if (!bounded && cursor?.direction === BACKWARD) {
    throw fastify.httpErrors.badRequest(
      `A backward \`cursor\` needs a \`limit\` when requesting ${mediaType}; follow the \`Link\` header`,
    );
  }

  const start = () => {
    const group = posix.basename(fastify.prefix);
    reply
      .type(format.contentType)
      .header('Content-Disposition', `attachment; filename="${group}.${format.extension}"`);
  };
  const body = (records) => serializer.header() + records.map(serializer.record).join('');
  const isHead = request.method === 'HEAD';

  if (filters.ids) {
    const records = repository
      ? (await repository.readHeads({ ids: filters.ids, fields: filters.fields })).records
      : filters.ids.map((permid) => stub(permid));
    records.forEach(hydrate);
    start();
    return reply.send(isHead ? '' : body(records));
  }

  if (!repository) {
    const records = [stub()];
    records.forEach(hydrate);
    start();
    return reply.send(isHead ? '' : body(records));
  }

  if (bounded) {
    const page = await repository.readHeads({ fields: filters.fields, page: filters.page });
    page.records.forEach(hydrate);
    const links = pageLinks(request.url, page, cursor, fastify.publicBaseUrl);
    const link = Object.entries(links)
      .filter(([, url]) => url)
      .map(([rel, url]) => `<${url}>; rel="${rel}"`)
      .join(', ');
    start();
    if (link) reply.header('Link', link);
    return reply.send(isHead ? '' : body(page.records));
  }

  // Unbounded. HEAD reads one batch for its status and headers, and takes no slot.
  const batch = (after) =>
    repository.readHeads({
      fields: filters.fields,
      page: { limit: MAX_LIMIT, ...(after ? { cursor: { permid: after, direction: FORWARD } } : {}) },
    });

  if (isHead) {
    await batch(cursor?.permid);
    start();
    return reply.send('');
  }

  const slots = fastify.exports;
  if (slots.running >= slots.max) {
    reply.header('Retry-After', String(RETRY_AFTER));
    throw fastify.httpErrors.serviceUnavailable(
      `Too many exports are running; retry in ${RETRY_AFTER} seconds, or send \`limit\` to page`,
    );
  }
  slots.running += 1;
  let released = false;
  const release = () => {
    if (!released) {
      released = true;
      slots.running -= 1;
    }
  };
  reply.raw.once('close', release);

  let first;
  try {
    first = await batch(cursor?.permid);
  } catch (err) {
    release();
    throw err;
  }
  first.records.forEach(hydrate);

  async function* chunks() {
    yield serializer.header();
    let page = first;
    for (;;) {
      if (page.records.length > 0) yield page.records.map(serializer.record).join('');
      if (!page.hasMore || page.records.length === 0) return;
      page = await batch(page.records.at(-1).permid);
      page.records.forEach(hydrate);
    }
  }

  const stream = Readable.from(chunks(), { objectMode: false });
  stream.once('close', release);
  start();
  return reply.send(stream);
}
