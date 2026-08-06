import type { FastifyInstance } from 'fastify';
import { getDatabase } from '../db/runtime.js';
import type { StorageAdapter } from '../storage/adapter.js';
import { updateUserUsage } from '../services/usage.service.js';

export function createRecycleBinRoutes(storage: StorageAdapter) {
  return async function recycleBinRoutes(fastify: FastifyInstance): Promise<void> {
    // List recycle bin items
    fastify.get('/api/recycle-bin', async (request) => {
      const db = getDatabase();
      const items = await db.all(`
        SELECT * FROM recycle_bin 
        WHERE user_id = ? 
        ORDER BY deleted_at DESC
      `, [request.userId]) as any[];

      const now = Date.now();
      const enriched = items.map((item: any) => {
        const expiresAt = new Date(item.expires_at).getTime();
        const remainingMs = Math.max(0, expiresAt - now);
        const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));

        let data;
        try {
          data = JSON.parse(item.original_data);
        } catch {
          data = {};
        }

        // Extract a human-readable name
        let name = 'Unknown item';
        if (item.item_type === 'session' && data.session) name = data.session.name;
        else if (item.item_type === 'subject' && data.subject) name = data.subject.name;
        else if (item.item_type === 'work' && data.work) name = data.work.title;
        else if (item.item_type === 'file' && data.file) name = data.file.filename;

        return {
          id: item.id,
          item_type: item.item_type,
          item_id: item.item_id,
          name,
          deleted_at: item.deleted_at,
          expires_at: item.expires_at,
          remaining_days: remainingDays,
        };
      });

      return { items: enriched };
    });

    // Restore item from recycle bin
    fastify.post<{ Params: { id: string } }>(
      '/api/recycle-bin/:id/restore',
      async (request, reply) => {
        const db = getDatabase();
        const item = await db.get(
          'SELECT * FROM recycle_bin WHERE id = ? AND user_id = ?'
        , [request.params.id, request.userId]) as any;

        if (!item) {
          return reply.status(404).send({ error: 'Recycle bin item not found' });
        }

        let data;
        try {
          data = JSON.parse(item.original_data);
        } catch {
          return reply.status(500).send({ error: 'Could not parse item data' });
        }

        const restoreTransaction = async () => {
          switch (item.item_type) {
            case 'session':
              await restoreSession(db, data);
              break;
            case 'subject':
              await restoreSubject(db, data);
              break;
            case 'work':
              await restoreWork(db, data);
              break;
            case 'file':
              await restoreFile(db, data);
              break;
          }

          await updateUserUsage({ userId: request.userId, timestamp: new Date().toISOString() });

          // Remove from recycle bin
          await db.run('DELETE FROM recycle_bin WHERE id = ?', [item.id]);
        };

        await db.transaction(restoreTransaction);
        return { success: true, message: `${item.item_type} restored successfully` };
      }
    );

    // Permanently delete from recycle bin
    fastify.delete<{ Params: { id: string } }>(
      '/api/recycle-bin/:id',
      async (request, reply) => {
        const db = getDatabase();
        const item = await db.get(
          'SELECT * FROM recycle_bin WHERE id = ? AND user_id = ?'
        , [request.params.id, request.userId]) as any;

        if (!item) {
          return reply.status(404).send({ error: 'Recycle bin item not found' });
        }

        let data;
        try {
          data = JSON.parse(item.original_data);
        } catch {
          data = {};
        }

        // Delete files from storage
        const filesToDelete = extractFiles(item.item_type, data);
        for (const file of filesToDelete) {
          try {
            await storage.delete(file.storage_key);
          } catch {
            // Continue even if storage delete fails
          }
        }

        await db.run('DELETE FROM recycle_bin WHERE id = ?', [item.id]);
        return { success: true, message: 'Permanently deleted' };
      }
    );
  };
}

async function restoreSession(db: any, data: any): Promise<void> {
  const { session, subjects, works, files } = data;

  await db.run(`
    INSERT INTO academic_sessions (id, user_id, name, auto_delete, auto_delete_date, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `, [session.id, session.user_id, session.name, session.auto_delete, session.auto_delete_date, session.created_at]);

  if (subjects) {
    for (const sub of subjects) {
      await db.run(`
        INSERT INTO subjects (id, session_id, user_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `, [sub.id, sub.session_id, sub.user_id, sub.name, sub.created_at]);
    }
  }

  if (works) {
    for (const work of works) {
      await db.run(`
        INSERT INTO works (id, subject_id, user_id, title, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `, [work.id, work.subject_id, work.user_id, work.title, work.created_at]);
    }
  }

  if (files) {
    for (const file of files) {
      await db.run(`
        INSERT INTO files (id, work_id, user_id, filename, sanitized_filename, extension, size_bytes, storage_key, content_type, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [file.id, file.work_id, file.user_id, file.filename, file.sanitized_filename, file.extension, file.size_bytes, file.storage_key, file.content_type, file.created_at]);
    }
  }
}

async function restoreSubject(db: any, data: any): Promise<void> {
  const { subject, works, files } = data;

  // Verify parent session still exists
  const session = await db.get('SELECT id FROM academic_sessions WHERE id = ?', [subject.session_id]);
  if (!session) {
    throw new Error('Parent session no longer exists. Cannot restore.');
  }

  await db.run(`
    INSERT INTO subjects (id, session_id, user_id, name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `, [subject.id, subject.session_id, subject.user_id, subject.name, subject.created_at]);

  if (works) {
    for (const work of works) {
      await db.run(`
        INSERT INTO works (id, subject_id, user_id, title, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `, [work.id, work.subject_id, work.user_id, work.title, work.created_at]);
    }
  }

  if (files) {
    for (const file of files) {
      await db.run(`
        INSERT INTO files (id, work_id, user_id, filename, sanitized_filename, extension, size_bytes, storage_key, content_type, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [file.id, file.work_id, file.user_id, file.filename, file.sanitized_filename, file.extension, file.size_bytes, file.storage_key, file.content_type, file.created_at]);
    }
  }
}

async function restoreWork(db: any, data: any): Promise<void> {
  const { work, files } = data;

  const subject = await db.get('SELECT id FROM subjects WHERE id = ?', [work.subject_id]);
  if (!subject) {
    throw new Error('Parent subject no longer exists. Cannot restore.');
  }

  await db.run(`
    INSERT INTO works (id, subject_id, user_id, title, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `, [work.id, work.subject_id, work.user_id, work.title, work.created_at]);

  if (files) {
    for (const file of files) {
      await db.run(`
        INSERT INTO files (id, work_id, user_id, filename, sanitized_filename, extension, size_bytes, storage_key, content_type, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [file.id, file.work_id, file.user_id, file.filename, file.sanitized_filename, file.extension, file.size_bytes, file.storage_key, file.content_type, file.created_at]);
    }
  }
}

async function restoreFile(db: any, data: any): Promise<void> {
  const { file } = data;

  const work = await db.get('SELECT id FROM works WHERE id = ?', [file.work_id]);
  if (!work) {
    throw new Error('Parent work no longer exists. Cannot restore.');
  }

  await db.run(`
    INSERT INTO files (id, work_id, user_id, filename, sanitized_filename, extension, size_bytes, storage_key, content_type, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [file.id, file.work_id, file.user_id, file.filename, file.sanitized_filename, file.extension, file.size_bytes, file.storage_key, file.content_type, file.created_at]);
}

function extractFiles(itemType: string, data: any): any[] {
  switch (itemType) {
    case 'file':
      return data.file ? [data.file] : [];
    case 'work':
      return data.files || [];
    case 'subject':
      return data.files || [];
    case 'session':
      return data.files || [];
    default:
      return [];
  }
}
