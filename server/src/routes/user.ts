import type { FastifyInstance } from 'fastify';
import { getDatabase } from '../db/runtime.js';
import { updateUserUsage } from '../services/usage.service.js';
import { evaluateAbuseSignals } from '../services/moderation.service.js';
import { getSecurityConfig } from '../services/config.service.js';
import { rateLimiter } from '../services/rate-limit.service.js';

const securityConfig = getSecurityConfig();

export async function userRoutes(fastify: FastifyInstance): Promise<void> {
  // Get user status (onboarding state)
  fastify.get('/api/user/status', async (request, reply) => {
    // Apply rate limit for logins
    const rateResult = rateLimiter.check(`login:${request.userId}`, { limit: securityConfig.loginRateLimit, windowMs: 60 * 1000 });
    if (!rateResult.allowed) {
      return reply.status(429).send({ error: 'Too many login requests. Please wait a minute before trying again.' });
    }

    const db = getDatabase();
    const user = await db.get('SELECT * FROM users WHERE clerk_id = ?', [request.userId]) as any;

    if (!user) {
      // First time user — create record
      await db.run('INSERT INTO users (clerk_id) VALUES (?)', [request.userId]);
      await updateUserUsage({ userId: request.userId, loginDelta: 1, timestamp: new Date().toISOString() });
      await evaluateAbuseSignals({ userId: request.userId, action: 'login', ipAddress: request.ip, userAgent: request.headers['user-agent'] });
      return { onboarding_completed: false, is_new: true };
    }

    await updateUserUsage({ userId: request.userId, loginDelta: 1, timestamp: new Date().toISOString() });
    await evaluateAbuseSignals({ userId: request.userId, action: 'login', ipAddress: request.ip, userAgent: request.headers['user-agent'] });

    return {
      onboarding_completed: Boolean(user.onboarding_completed),
      is_new: false,
      uploads_suspended: Boolean(user.uploads_suspended),
      suspension_reason: user.suspension_reason || null,
    };
  });

  // Complete onboarding
  fastify.post('/api/user/complete-onboarding', async (request) => {
    const db = getDatabase();

    // Ensure user exists
    const user = await db.get('SELECT * FROM users WHERE clerk_id = ?', [request.userId]) as any;
    if (!user) {
      await db.run('INSERT INTO users (clerk_id, onboarding_completed) VALUES (?, 1)', [request.userId]);
    } else {
      await db.run('UPDATE users SET onboarding_completed = 1, updated_at = datetime(\'now\') WHERE clerk_id = ?', [request.userId]);
    }
    await updateUserUsage({ userId: request.userId, loginDelta: 1, timestamp: new Date().toISOString() });

    return { success: true };
  });
}
