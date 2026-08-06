import { getDatabase } from '../db/runtime.js';

export interface AuditLogPayload {
  userId: string;
  action: string;
  resourceType?: string;
  resourceId?: string | number | null;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

export async function writeAuditLog(payload: AuditLogPayload): Promise<void> {
  const db = getDatabase();
  await db.run(
    `
      INSERT INTO audit_logs (
        user_id,
        action,
        resource_type,
        resource_id,
        ip_address,
        user_agent,
        created_at,
        metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      payload.userId,
      payload.action,
      payload.resourceType ?? null,
      payload.resourceId ?? null,
      payload.ipAddress ?? null,
      payload.userAgent ?? null,
      new Date().toISOString(),
      payload.metadata ? JSON.stringify(payload.metadata) : null,
    ]
  );
}
