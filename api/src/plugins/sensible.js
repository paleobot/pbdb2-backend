import fp from 'fastify-plugin';
import sensible from '@fastify/sensible';

/**
 * @fastify/sensible — adds `httpErrors`, `assert`, and other small utilities
 * used by route handlers and the error handler.
 */
export default fp(async (fastify) => {
  await fastify.register(sensible);
});
