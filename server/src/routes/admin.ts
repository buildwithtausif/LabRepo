import type { FastifyInstance } from 'fastify';
import type { StorageAdapter } from '../storage/adapter.js';
import { getDb } from '../db/runtime.js';
import { users, abuseFlags, auditLogs, userUsageStats, academicSessions, siteSettings, files, works, subjects, recycleBin, dailyUsageHistory } from '../db/schema.js';
import { writeAuditLog } from '../services/audit.service.js';
import { eq, sql, count, sum } from 'drizzle-orm';

function isAdminUser(userId: string): boolean {
  return userId === process.env.ADMIN_USER_ID || userId === process.env.CLERK_ADMIN_USER_ID;
}

export function createAdminRoutes(storage: StorageAdapter) {
  return async function adminRoutes(fastify: FastifyInstance): Promise<void> {
    fastify.addHook('preHandler', async (request, reply) => {
    if (!isAdminUser(request.userId)) {
      return reply.status(403).send({ error: 'Admin access required' });
    }
  });

  // Summary stats
  fastify.get('/api/admin/summary', async () => {
    const db = getDb();

    const [userCount] = await db.select({ count: count() }).from(users);
    const [flagCount] = await db.select({ count: count() }).from(abuseFlags).where(eq(abuseFlags.resolved, 0));
    const [logCount] = await db.select({ count: count() }).from(auditLogs);

    // Auto-heal usage stats to fix any existing desyncs
    const allUsers = await db.select({ id: users.clerkId }).from(users);
    for (const u of allUsers) {
      const [fileStats] = await db
        .select({
          totalSize: sql<number>`COALESCE(SUM(${files.sizeBytes}), 0)`,
          count: sql<number>`COUNT(${files.id})`
        })
        .from(files)
        .where(eq(files.userId, u.id));
        
      await db
        .update(userUsageStats)
        .set({
          storageUsed: Number(fileStats.totalSize),
          fileCount: Number(fileStats.count)
        })
        .where(eq(userUsageStats.userId, u.id));
    }
    const [usage] = await db
      .select({
        storage_used: sum(userUsageStats.storageUsed),
        total_uploads: sum(userUsageStats.totalUploads),
        total_downloads: sum(userUsageStats.totalDownloads),
      })
      .from(userUsageStats);

    const [lifetime] = await db
      .select({
        total_users_ever: sql<number>`COUNT(DISTINCT ${dailyUsageHistory.userId})`,
        lifetime_uploads: sum(dailyUsageHistory.uploads),
        lifetime_downloads: sum(dailyUsageHistory.downloads),
      })
      .from(dailyUsageHistory);

    return {
      users: userCount?.count ?? 0,
      openFlags: flagCount?.count ?? 0,
      auditLogCount: logCount?.count ?? 0,
      storageUsed: Number(usage?.storage_used ?? 0),
      totalUploads: Number(usage?.total_uploads ?? 0),
      totalDownloads: Number(usage?.total_downloads ?? 0),
      lifetimeUsers: Number(lifetime?.total_users_ever ?? 0),
      lifetimeUploads: Number(lifetime?.lifetime_uploads ?? 0),
      lifetimeDownloads: Number(lifetime?.lifetime_downloads ?? 0),
    };
  });

  // List all users with usage stats
  fastify.get('/api/admin/users', async () => {
    const db = getDb();
    const result = await db
      .select({
        id: users.id,
        clerk_id: users.clerkId,
        onboarding_completed: users.onboardingCompleted,
        uploads_suspended: users.uploadsSuspended,
        created_at: users.createdAt,
        updated_at: users.updatedAt,
        storage_used: sql<number>`COALESCE(${userUsageStats.storageUsed}, 0)`,
        file_count: sql<number>`COALESCE(${userUsageStats.fileCount}, 0)`,
        total_uploads: sql<number>`COALESCE(${userUsageStats.totalUploads}, 0)`,
        total_downloads: sql<number>`COALESCE(${userUsageStats.totalDownloads}, 0)`,
        last_upload_at: userUsageStats.lastUploadAt,
        last_login_at: userUsageStats.lastLoginAt,
        session_count: sql<number>`(SELECT COUNT(*) FROM academic_sessions WHERE user_id = users.clerk_id)`,
        open_flags: sql<number>`(SELECT COUNT(*) FROM abuse_flags WHERE user_id = users.clerk_id AND resolved = 0)`,
      })
      .from(users)
      .leftJoin(userUsageStats, eq(userUsageStats.userId, users.clerkId))
      .orderBy(sql`${users.createdAt} DESC`);

    return { users: result };
  });

  // Audit logs
  fastify.get('/api/admin/audit-logs', async () => {
    const db = getDb();
    const logs = await db
      .select()
      .from(auditLogs)
      .orderBy(sql`${auditLogs.createdAt} DESC`)
      .limit(50);

    return { logs };
  });

  // Abuse flags
  fastify.get('/api/admin/abuse-flags', async () => {
    const db = getDb();
    const flags = await db
      .select()
      .from(abuseFlags)
      .orderBy(sql`${abuseFlags.createdAt} DESC`)
      .limit(50);

    return { flags };
  });

  // Resolve a flag
  fastify.post<{ Params: { id: string }; Body: { notes?: string } }>('/api/admin/flags/:id/resolve', async (request, reply) => {
    const db = getDb();
    const [flag] = await db
      .select()
      .from(abuseFlags)
      .where(eq(abuseFlags.id, Number(request.params.id)))
      .limit(1);

    if (!flag) {
      return reply.status(404).send({ error: 'Flag not found' });
    }

    await db
      .update(abuseFlags)
      .set({
        resolved: 1,
        resolvedBy: request.userId,
        notes: (request.body as any)?.notes ?? flag.notes,
      })
      .where(eq(abuseFlags.id, Number(request.params.id)));

    await writeAuditLog({
      userId: request.userId,
      action: 'admin_resolved_flag',
      resourceType: 'abuse_flag',
      resourceId: request.params.id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      metadata: { flagId: request.params.id },
    });

    return { success: true };
  });

  // Suspend uploads for a user
  fastify.post<{ Params: { userId: string }; Body: { notes?: string } }>('/api/admin/users/:userId/suspend-uploads', async (request) => {
    const db = getDb();
    const userId = request.params.userId;
    const notes = (request.body as any)?.notes ?? 'Uploads suspended by admin';

    await db
      .update(users)
      .set({
        uploadsSuspended: 1,
        suspensionReason: notes,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(users.clerkId, userId));

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
  fastify.post<{ Params: { userId: string }; Body: { notes?: string } }>('/api/admin/users/:userId/restore', async (request) => {
    const db = getDb();
    const userId = request.params.userId;
    const notes = (request.body as any)?.notes ?? 'Account restored by admin';

    await db
      .update(users)
      .set({
        uploadsSuspended: 0,
        suspensionReason: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(users.clerkId, userId));

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

  // Hard delete a user
  fastify.delete<{ Params: { userId: string } }>('/api/admin/users/:userId/hard-delete', async (request, reply) => {
    const db = getDb();
    const userId = request.params.userId;

    // 1. Fetch all files for physical deletion
    const userFiles = await db.select({ storageKey: files.storageKey }).from(files).where(eq(files.userId, userId));
    for (const f of userFiles) {
      if (f.storageKey) {
        try {
          await storage.delete(f.storageKey);
        } catch (e) {
          console.error(`Failed to physically delete file ${f.storageKey}:`, e);
        }
      }
    }

    // 2. Wipe everything from DB in a transaction
    await db.transaction(async (tx) => {
      await tx.delete(recycleBin).where(eq(recycleBin.userId, userId));
      await tx.delete(files).where(eq(files.userId, userId));
      await tx.delete(works).where(eq(works.userId, userId));
      await tx.delete(subjects).where(eq(subjects.userId, userId));
      await tx.delete(academicSessions).where(eq(academicSessions.userId, userId));
      await tx.delete(userUsageStats).where(eq(userUsageStats.userId, userId));
      await tx.delete(abuseFlags).where(eq(abuseFlags.userId, userId));
      await tx.delete(auditLogs).where(eq(auditLogs.userId, userId));
      await tx.delete(users).where(eq(users.clerkId, userId));
    });

    await writeAuditLog({
      userId: request.userId,
      action: 'admin_hard_deleted_user',
      resourceType: 'user',
      resourceId: userId,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      metadata: {},
    });

    return { success: true, userId, action: 'hard_deleted' };
  });

    // Storage health and stats
    fastify.get('/api/admin/storage', async () => {
      const db = getDb();
      
      // DB-level stats
      const [usage] = await db
        .select({
          total_files: sum(userUsageStats.fileCount),
          storage_used: sum(userUsageStats.storageUsed),
        })
        .from(userUsageStats);

      const stats = {
        totalFiles: Number(usage?.total_files ?? 0),
        storageUsed: Number(usage?.storage_used ?? 0),
        driver: process.env.STORAGE_DRIVER || 'mock',
      };

      // Check storage health using a non-intrusive method if possible
      // Note: We avoid listing all files for privacy. We just return DB stats.
      return { stats };
    });

    // SEO Settings Management
    fastify.get('/api/admin/seo', async () => {
      const db = getDb();
      const settings = await db.select().from(siteSettings).where(sql`${siteSettings.key} LIKE 'seo.%'`);
      const seo: Record<string, string> = {};
      for (const s of settings) {
        seo[s.key.replace('seo.', '')] = s.value;
      }
      return { seo };
    });

    fastify.post('/api/admin/seo', async (request, reply) => {
      const db = getDb();
      const data = request.body as Record<string, string>;
      
      await db.transaction(async (tx) => {
        for (const [key, value] of Object.entries(data)) {
          if (!key || typeof value !== 'string') continue;
          const fullKey = `seo.${key}`;
          
          // Upsert setting
          const [existing] = await tx.select().from(siteSettings).where(eq(siteSettings.key, fullKey)).limit(1);
          if (existing) {
            await tx.update(siteSettings).set({ value, updatedAt: new Date().toISOString() }).where(eq(siteSettings.key, fullKey));
          } else {
            await tx.insert(siteSettings).values({ key: fullKey, value, updatedAt: new Date().toISOString() });
          }
        }
      });

      await writeAuditLog({
        userId: request.userId,
        action: 'admin_updated_seo',
        resourceType: 'site_settings',
        resourceId: 'seo',
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      return { success: true };
    });

    // Since OG Image is requested as upload, we would handle it via multipart
    fastify.post('/api/admin/seo/og-image', async (request, reply) => {
      const parts = request.parts();
      let ogImageUrl = '';
      
      for await (const part of parts) {
        if (part.type === 'file' && part.fieldname === 'image') {
          const chunks: Buffer[] = [];
          for await (const chunk of part.file) {
            chunks.push(chunk);
          }
          const data = Buffer.concat(chunks);
          
          // Store the image in the configured storage under a public-accessible prefix if possible
          if (storage) {
            const key = `public/seo/og-image-${Date.now()}.${part.mimetype === 'image/png' ? 'png' : 'jpg'}`;
            await storage.upload(key, data, part.mimetype);
            ogImageUrl = `/api/public/storage/${key}`;
            
            const db = getDb();
            const fullKey = 'seo.image';
            const [existing] = await db.select().from(siteSettings).where(eq(siteSettings.key, fullKey)).limit(1);
            if (existing) {
              await db.update(siteSettings).set({ value: ogImageUrl, updatedAt: new Date().toISOString() }).where(eq(siteSettings.key, fullKey));
            } else {
              await db.insert(siteSettings).values({ key: fullKey, value: ogImageUrl, updatedAt: new Date().toISOString() });
            }
          }
        }
      }
      
      return { success: true, url: ogImageUrl };
    });
  };
}
