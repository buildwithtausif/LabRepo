import type { FastifyInstance } from 'fastify';
import { getDatabase } from '../db/runtime.js';

export async function userRoutes(fastify: FastifyInstance): Promise<void> {
  // Get user status (onboarding state)
  fastify.get('/api/user/status', async (request) => {
    const db = getDatabase();
    const user = await db.get('SELECT * FROM users WHERE clerk_id = ?', [request.userId]) as any;

    if (!user) {
      // First time user — create record
      await db.run('INSERT INTO users (clerk_id) VALUES (?)', [request.userId]);
      return { onboarding_completed: false, is_new: true };
    }

    return {
      onboarding_completed: Boolean(user.onboarding_completed),
      is_new: false,
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

    return { success: true };
  });
}
