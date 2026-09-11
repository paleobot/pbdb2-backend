/**
 * The `taxa` resource: the API's first READ-ONLY route group.
 *
 * `taxa` is materialized output of the backend's `derive_taxa()`, upserted in
 * place by `rebuild_taxa()`. It is never written through the API — the write
 * surface for taxonomy is the *opinion* tables (`name_opinions`,
 * `assignment_opinions`, `validity_opinions`), which are version-chained,
 * person-attributed, and their own future resources. So write verbs answer 405
 * rather than returning a stub that would advertise a path that cannot exist.
 *
 * Reads go through `taxa-repository.js` rather than the generic repository:
 * `taxa` has no JSONB payload and no version chain. The list still goes through
 * the shared `listReadHandler`, so `ids` and pagination behave exactly as they
 * do on every other group.
 *
 * There is NO STUB. Every other group falls back to stub data when no database
 * is configured; a stubbed taxonomy would be a fiction — half a million derived
 * rows whose whole value is that they are real — so with no connection the route
 * fails loudly instead.
 */

import { registerCrudRoutes } from '../../../../lib/crud-routes.js';
import { taxaRepository } from '../../../../lib/taxa-repository.js';
import { descriptorFor } from '../../../../lib/resource-tables.js';
import { hydrateLinkHrefs, hydrateChainHrefs } from '../../../../lib/link-hydration.js';

const TYPE = 'taxon';

export default async function taxa(fastify) {
  const descriptor = descriptorFor('taxa');
  const repository = taxaRepository(fastify);

  // Links and the containing chain are hydrated at this boundary; the
  // persistence layer emits pure `{ label, permid }` objects with no HTTP
  // knowledge. The chain points back into this same group.
  const hydrate = (record) =>
    hydrateChainHrefs(hydrateLinkHrefs(record, descriptor.links, fastify.prefix), fastify.prefix);

  // Throws synchronously, so the shared handlers' `stub()` call surfaces as a
  // 503 through the normal error path rather than resolving to a stub record.
  const noDatabase = () => {
    throw fastify.httpErrors.serviceUnavailable(
      'The taxa resource requires a PostgreSQL connection; none is configured',
    );
  };

  registerCrudRoutes(fastify, {
    type: TYPE,
    readOnly: true,
    repository,
    links: descriptor.links,
    expansions: descriptor.expansions,
    hydrate,
    // Reached only when no database is configured: the shared handlers fall back
    // to `stub` in that case, and taxa's fallback is an honest failure.
    stub: noDatabase,
  });
}
