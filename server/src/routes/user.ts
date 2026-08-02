import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/index.js';

export async function userRoutes(fastify: FastifyInstance): Promise<void> {
  // Get user status (onboarding state)
  fastify.get('/api/user/status', async (request) => {
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE clerk_id = ?').get(request.userId) as any;

    if (!user) {
      // First time user — create record
      db.prepare('INSERT INTO users (clerk_id) VALUES (?)').run(request.userId);
      return { onboarding_completed: false, is_new: true };
    }

    return {
      onboarding_completed: Boolean(user.onboarding_completed),
      is_new: false,
    };
  });

  // Complete onboarding
  fastify.post('/api/user/complete-onboarding', async (request) => {
    const db = getDb();

    // Ensure user exists
    const user = db.prepare('SELECT * FROM users WHERE clerk_id = ?').get(request.userId) as any;
    if (!user) {
      db.prepare('INSERT INTO users (clerk_id, onboarding_completed) VALUES (?, 1)').run(request.userId);
    } else {
      db.prepare('UPDATE users SET onboarding_completed = 1, updated_at = datetime(\'now\') WHERE clerk_id = ?').run(request.userId);
    }

    return { success: true };
  });
}
