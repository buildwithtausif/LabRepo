import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createClerkClient, verifyToken } from '@clerk/backend';
import fp from 'fastify-plugin';

const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY!,
});

declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
  }
}

/**
 * Clerk authentication plugin for Fastify.
 * Verifies JWT from the Authorization header and decorates the request with userId.
 */
async function clerkAuthPlugin(fastify: FastifyInstance): Promise<void> {
  fastify.decorateRequest('userId', '');

  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip auth for health check
    if (request.url === '/health') return;

    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Authentication required' });
    }

    const token = authHeader.substring(7);

    try {
      const payload = await verifyToken(token, {
        secretKey: process.env.CLERK_SECRET_KEY!,
      });
      if (!payload.sub) {
        return reply.status(401).send({ error: 'Invalid token: no subject' });
      }
      request.userId = payload.sub;
    } catch (err: any) {
      console.error('[clerkAuth] Token verification failed:', err);
      return reply.status(401).send({ error: 'Invalid or expired token', details: err.message });
    }
  });
}

export const clerkAuth = fp(clerkAuthPlugin);
