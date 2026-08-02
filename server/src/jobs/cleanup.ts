import { getDb } from '../db/index.js';
import type { StorageAdapter } from '../storage/adapter.js';

/**
 * Cleanup job — runs periodically to:
 * 1. Permanently delete expired recycle bin items (7 days)
 * 2. Auto-delete academic sessions past their auto_delete_date
 */
export function startCleanupJob(storage: StorageAdapter): void {
  // Run immediately on startup
  runCleanup(storage).catch(console.error);

  // Then run every hour
  setInterval(() => {
    runCleanup(storage).catch(console.error);
  }, 60 * 60 * 1000);
}

async function runCleanup(storage: StorageAdapter): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();

  // 1. Clean expired recycle bin items
  const expiredItems = db.prepare(
    "SELECT * FROM recycle_bin WHERE expires_at <= ?"
  ).all(now) as any[];

  for (const item of expiredItems) {
    let data;
    try {
      data = JSON.parse(item.original_data);
    } catch {
      continue;
    }

    // Delete files from storage
    const files = extractAllFiles(item.item_type, data);
    for (const file of files) {
      try {
        await storage.delete(file.storage_key);
      } catch (err) {
        console.error(`Failed to delete storage key ${file.storage_key}:`, err);
      }
    }

    db.prepare('DELETE FROM recycle_bin WHERE id = ?').run(item.id);
  }

  if (expiredItems.length > 0) {
    console.log(`[cleanup] Permanently deleted ${expiredItems.length} expired recycle bin items`);
  }

  // 2. Auto-delete sessions past their auto_delete_date
  const expiredSessions = db.prepare(`
    SELECT * FROM academic_sessions 
    WHERE auto_delete = 1 AND auto_delete_date IS NOT NULL AND auto_delete_date <= ?
  `).all(now.split('T')[0]) as any[];

  for (const session of expiredSessions) {
    const subjects = db.prepare('SELECT * FROM subjects WHERE session_id = ?').all(session.id) as any[];
    const subjectIds = subjects.map((s: any) => s.id);

    let works: any[] = [];
    let files: any[] = [];
    if (subjectIds.length > 0) {
      const placeholders = subjectIds.map(() => '?').join(',');
      works = db.prepare(`SELECT * FROM works WHERE subject_id IN (${placeholders})`).all(...subjectIds) as any[];
      const workIds = works.map((w: any) => w.id);
      if (workIds.length > 0) {
        const wPlaceholders = workIds.map(() => '?').join(',');
        files = db.prepare(`SELECT * FROM files WHERE work_id IN (${wPlaceholders})`).all(...workIds) as any[];
      }
    }

    // Move to recycle bin with 7-day retention
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const deleteTransaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO recycle_bin (user_id, item_type, item_id, original_data, expires_at)
        VALUES (?, 'session', ?, ?, ?)
      `).run(session.user_id, session.id, JSON.stringify({ session, subjects, works, files }), expiresAt);

      db.prepare('DELETE FROM academic_sessions WHERE id = ?').run(session.id);
    });

    deleteTransaction();
    console.log(`[cleanup] Auto-deleted session "${session.name}" for user ${session.user_id}`);
  }
}

function extractAllFiles(itemType: string, data: any): any[] {
  switch (itemType) {
    case 'file':
      return data.file ? [data.file] : [];
    case 'work':
    case 'subject':
    case 'session':
      return data.files || [];
    default:
      return [];
  }
}
