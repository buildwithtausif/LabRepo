import { getDatabase } from '../db/runtime.js';
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
  const db = getDatabase();
  const now = new Date().toISOString();

  // 1. Clean expired recycle bin items
  const expiredItems = await db.all(
    "SELECT * FROM recycle_bin WHERE expires_at <= ?"
  , [now]) as any[];

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

    await db.run('DELETE FROM recycle_bin WHERE id = ?', [item.id]);
  }

  if (expiredItems.length > 0) {
    console.log(`[cleanup] Permanently deleted ${expiredItems.length} expired recycle bin items`);
  }

  // 2. Auto-delete sessions past their auto_delete_date
  const expiredSessions = await db.all(`
    SELECT * FROM academic_sessions 
    WHERE auto_delete = 1 AND auto_delete_date IS NOT NULL AND auto_delete_date <= ?
  `, [now.split('T')[0]]) as any[];

  for (const session of expiredSessions) {
    const subjects = await db.all('SELECT * FROM subjects WHERE session_id = ?', [session.id]) as any[];
    const subjectIds = subjects.map((s: any) => s.id);

    let works: any[] = [];
    let files: any[] = [];
    if (subjectIds.length > 0) {
      const placeholders = subjectIds.map(() => '?').join(',');
      works = await db.all(`SELECT * FROM works WHERE subject_id IN (${placeholders})`, subjectIds) as any[];
      const workIds = works.map((w: any) => w.id);
      if (workIds.length > 0) {
        const wPlaceholders = workIds.map(() => '?').join(',');
        files = await db.all(`SELECT * FROM files WHERE work_id IN (${wPlaceholders})`, workIds) as any[];
      }
    }

    // Move to recycle bin with 7-day retention
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const deleteTransaction = async () => {
      await db.run(`
        INSERT INTO recycle_bin (user_id, item_type, item_id, original_data, expires_at)
        VALUES (?, 'session', ?, ?, ?)
      `, [session.user_id, session.id, JSON.stringify({ session, subjects, works, files }), expiresAt]);

      await db.run('DELETE FROM academic_sessions WHERE id = ?', [session.id]);
    };

    await db.transaction(deleteTransaction);
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
