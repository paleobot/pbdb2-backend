import fp from 'fastify-plugin';

/**
 * STUB authentication seam.
 *
 * `fastify.authenticate` is currently a NO-OP preHandler: it lets every request
 * through without verifying any token. Routes attach it to write verbs
 * (POST/PUT/PATCH/DELETE) so that a future change can replace the body of this
 * function with real JWT verification WITHOUT touching any route.
 *
 * `fastify.authStub.invocations` counts how many times the seam has run. It
 * exists only to make the stub observable in tests (proving the seam is wired
 * to write verbs and not to GET); real auth can drop it.
 *
 * Deferred to a future change: real JWT verification and a `/login` route.
 */
export default fp(async (fastify) => {
  fastify.decorate('authStub', { invocations: 0 });

  fastify.decorate('authenticate', async function authenticate(_request, _reply) {
    fastify.authStub.invocations += 1;
    // no-op: real JWT verification lands in a future change.
  });
});
