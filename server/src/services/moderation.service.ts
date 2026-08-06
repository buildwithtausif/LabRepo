import { getDatabase } from '../db/runtime.js';
import { writeAuditLog } from './audit.service.js';

export interface AbuseRuleResult {
  flagged: boolean;
  reason?: string;
  severity?: 'low' | 'medium' | 'high';
}

export async function evaluateAbuseSignals(input: {
  userId: string;
  action: 'upload' | 'download' | 'login' | 'repository_create';
  ipAddress?: string;
  userAgent?: string;
}): Promise<AbuseRuleResult> {
  const db = getDatabase();
  const now = new Date();
  const windowStart = new Date(now.getTime() - 60 * 60 * 1000).toISOString();

  if (input.action === 'upload') {
    const recentUploads = await db.get(
      'SELECT COUNT(*) as count FROM audit_logs WHERE user_id = ? AND action = ? AND created_at >= ?',
      [input.userId, 'file_uploaded', windowStart]
    ) as any;

    if (Number(recentUploads?.count ?? 0) >= 20) {
      await createAbuseFlag(input.userId, 'UPLOAD_SPAM', 'high', 'Upload burst detected', input.ipAddress, input.userAgent);
      return { flagged: true, reason: 'Upload burst detected', severity: 'high' };
    }
  }

  if (input.action === 'login') {
    const recentFailures = await db.get(
      'SELECT COUNT(*) as count FROM audit_logs WHERE user_id = ? AND action = ? AND created_at >= ?',
      [input.userId, 'failed_login', windowStart]
    ) as any;

    if (Number(recentFailures?.count ?? 0) >= 5) {
      await createAbuseFlag(input.userId, 'LOGIN_ATTACK', 'high', 'Repeated failed login attempts', input.ipAddress, input.userAgent);
      return { flagged: true, reason: 'Repeated failed login attempts', severity: 'high' };
    }
  }

  return { flagged: false };
}

async function createAbuseFlag(
  userId: string,
  type: string,
  severity: 'low' | 'medium' | 'high',
  reason: string,
  ipAddress?: string,
  userAgent?: string,
): Promise<void> {
  const db = getDatabase();
  await db.run(`
    INSERT INTO abuse_flags (user_id, type, severity, reason, resolved, notes)
    VALUES (?, ?, ?, ?, 0, ?)
  `, [userId, type, severity, reason, JSON.stringify({ ipAddress, userAgent })]);

  await writeAuditLog({
    userId,
    action: 'abuse_flag_created',
    resourceType: 'abuse_flag',
    resourceId: null,
    ipAddress,
    userAgent,
    metadata: { type, severity, reason },
  });
}
