import type { FastifyInstance } from 'fastify';
import { getDatabase } from '../db/runtime.js';
import { writeAuditLog } from '../services/audit.service.js';

function isAdminUser(userId: string): boolean {
  return userId === process.env.ADMIN_USER_ID || userId === process.env.CLERK_ADMIN_USER_ID;
}

export async function adminRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', async (request, reply) => {
    if (!isAdminUser(request.userId)) {
      return reply.status(403).send({ error: 'Admin access required' });
    }
  });

  // Summary stats
  fastify.get('/api/admin/summary', async (request) => {
    const db = getDatabase();
    const [users, flags, logs, usage] = await Promise.all([
      db.get('SELECT COUNT(*) as count FROM users'),
      db.get('SELECT COUNT(*) as count FROM abuse_flags WHERE resolved = 0'),
      db.get('SELECT COUNT(*) as count FROM audit_logs'),
      db.get('SELECT SUM(storage_used) as storage_used, SUM(total_uploads) as total_uploads, SUM(total_downloads) as total_downloads FROM user_usage_stats'),
    ]);

    return {
      users: Number((users as any)?.count ?? 0),
      openFlags: Number((flags as any)?.count ?? 0),
      auditLogCount: Number((logs as any)?.count ?? 0),
      storageUsed: Number((usage as any)?.storage_used ?? 0),
      totalUploads: Number((usage as any)?.total_uploads ?? 0),
      totalDownloads: Number((usage as any)?.total_downloads ?? 0),
    };
  });

  // List all users with usage stats
  fastify.get('/api/admin/users', async (request) => {
    const db = getDatabase();
    const users = await db.all(`
      SELECT
        u.id,
        u.clerk_id,
        u.onboarding_completed,
        u.uploads_suspended,
        u.created_at,
        u.updated_at,
        COALESCE(s.storage_used, 0) as storage_used,
        COALESCE(s.file_count, 0) as file_count,
        COALESCE(s.total_uploads, 0) as total_uploads,
        COALESCE(s.total_downloads, 0) as total_downloads,
        s.last_upload_at,
        s.last_login_at,
        (SELECT COUNT(*) FROM academic_sessions WHERE user_id = u.clerk_id) as session_count,
        (SELECT COUNT(*) FROM abuse_flags WHERE user_id = u.clerk_id AND resolved = 0) as open_flags
      FROM users u
      LEFT JOIN user_usage_stats s ON s.user_id = u.clerk_id
      ORDER BY u.created_at DESC
    `);

    return { users };
  });

  // Audit logs
  fastify.get('/api/admin/audit-logs', async (request) => {
    const db = getDatabase();
    const logs = await db.all(
      'SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 50'
    );

    return { logs };
  });

  // Abuse flags
  fastify.get('/api/admin/abuse-flags', async (request) => {
    const db = getDatabase();
    const flags = await db.all(
      'SELECT * FROM abuse_flags ORDER BY created_at DESC LIMIT 50'
    );

    return { flags };
  });

  // Resolve a flag
  fastify.post<{ Params: { id: string }; Body: { notes?: string } }>('/api/admin/flags/:id/resolve', async (request, reply) => {
    const db = getDatabase();
    const id = request.params.id;
    const flag = await db.get('SELECT * FROM abuse_flags WHERE id = ?', [id]);

    if (!flag) {
      return reply.status(404).send({ error: 'Flag not found' });
    }

    await db.run(
      'UPDATE abuse_flags SET resolved = 1, resolved_by = ?, notes = COALESCE(?, notes) WHERE id = ?',
      [request.userId, (request.body as any)?.notes ?? null, id]
    );

    await writeAuditLog({
      userId: request.userId,
      action: 'admin_resolved_flag',
      resourceType: 'abuse_flag',
      resourceId: id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      metadata: { flagId: id },
    });

    return { success: true };
  });

  // Suspend uploads for a user
  fastify.post<{ Params: { userId: string }; Body: { notes?: string } }>('/api/admin/users/:userId/suspend-uploads', async (request, reply) => {
    const db = getDatabase();
    const userId = request.params.userId;
    const notes = (request.body as any)?.notes ?? 'Uploads suspended by admin';

    // Actually set the suspended flag
    await db.run("UPDATE users SET uploads_suspended = 1, updated_at = datetime('now') WHERE clerk_id = ?", [userId]);

    await writeAuditLog({
      userId: request.userId,
      action: 'admin_suspended_uploads',
      resourceType: 'user',
      resourceId: userId,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      metadata: { notes },
    });

    return { success: true, userId, action: 'uploads_suspended' };
  });

  // Restore a user (unsuspend uploads)
  fastify.post<{ Params: { userId: string }; Body: { notes?: string } }>('/api/admin/users/:userId/restore', async (request, reply) => {
    const db = getDatabase();
    const userId = request.params.userId;
    const notes = (request.body as any)?.notes ?? 'Account restored by admin';

    // Clear the suspended flag
    await db.run("UPDATE users SET uploads_suspended = 0, updated_at = datetime('now') WHERE clerk_id = ?", [userId]);

    await writeAuditLog({
      userId: request.userId,
      action: 'admin_restored_user',
      resourceType: 'user',
      resourceId: userId,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      metadata: { notes },
    });

    return { success: true, userId, action: 'account_restored' };
  });
}
