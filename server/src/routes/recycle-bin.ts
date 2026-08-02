import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/index.js';
import type { StorageAdapter } from '../storage/adapter.js';

export function createRecycleBinRoutes(storage: StorageAdapter) {
  return async function recycleBinRoutes(fastify: FastifyInstance): Promise<void> {
    // List recycle bin items
    fastify.get('/api/recycle-bin', async (request) => {
      const db = getDb();
      const items = db.prepare(`
        SELECT * FROM recycle_bin 
        WHERE user_id = ? 
        ORDER BY deleted_at DESC
      `).all(request.userId) as any[];

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
        const db = getDb();
        const item = db.prepare(
          'SELECT * FROM recycle_bin WHERE id = ? AND user_id = ?'
        ).get(request.params.id, request.userId) as any;

        if (!item) {
          return reply.status(404).send({ error: 'Recycle bin item not found' });
        }

        let data;
        try {
          data = JSON.parse(item.original_data);
        } catch {
          return reply.status(500).send({ error: 'Could not parse item data' });
        }

        const restoreTransaction = db.transaction(() => {
          switch (item.item_type) {
            case 'session':
              restoreSession(db, data);
              break;
            case 'subject':
              restoreSubject(db, data);
              break;
            case 'work':
              restoreWork(db, data);
              break;
            case 'file':
              restoreFile(db, data);
              break;
          }

          // Remove from recycle bin
          db.prepare('DELETE FROM recycle_bin WHERE id = ?').run(item.id);
        });

        restoreTransaction();
        return { success: true, message: `${item.item_type} restored successfully` };
      }
    );

    // Permanently delete from recycle bin
    fastify.delete<{ Params: { id: string } }>(
      '/api/recycle-bin/:id',
      async (request, reply) => {
        const db = getDb();
        const item = db.prepare(
          'SELECT * FROM recycle_bin WHERE id = ? AND user_id = ?'
        ).get(request.params.id, request.userId) as any;

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

        db.prepare('DELETE FROM recycle_bin WHERE id = ?').run(item.id);
        return { success: true, message: 'Permanently deleted' };
      }
    );
  };
}

function restoreSession(db: any, data: any): void {
  const { session, subjects, works, files } = data;

  db.prepare(`
    INSERT INTO academic_sessions (id, user_id, name, auto_delete, auto_delete_date, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(session.id, session.user_id, session.name, session.auto_delete, session.auto_delete_date, session.created_at);

  if (subjects) {
    for (const sub of subjects) {
      db.prepare(`
        INSERT INTO subjects (id, session_id, user_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `).run(sub.id, sub.session_id, sub.user_id, sub.name, sub.created_at);
    }
  }

  if (works) {
    for (const work of works) {
      db.prepare(`
        INSERT INTO works (id, subject_id, user_id, title, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `).run(work.id, work.subject_id, work.user_id, work.title, work.created_at);
    }
  }

  if (files) {
    for (const file of files) {
      db.prepare(`
        INSERT INTO files (id, work_id, user_id, filename, sanitized_filename, extension, size_bytes, storage_key, content_type, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(file.id, file.work_id, file.user_id, file.filename, file.sanitized_filename, file.extension, file.size_bytes, file.storage_key, file.content_type, file.created_at);
    }
  }
}

function restoreSubject(db: any, data: any): void {
  const { subject, works, files } = data;

  // Verify parent session still exists
  const session = db.prepare('SELECT id FROM academic_sessions WHERE id = ?').get(subject.session_id);
  if (!session) {
    throw new Error('Parent session no longer exists. Cannot restore.');
  }

  db.prepare(`
    INSERT INTO subjects (id, session_id, user_id, name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `).run(subject.id, subject.session_id, subject.user_id, subject.name, subject.created_at);

  if (works) {
    for (const work of works) {
      db.prepare(`
        INSERT INTO works (id, subject_id, user_id, title, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `).run(work.id, work.subject_id, work.user_id, work.title, work.created_at);
    }
  }

  if (files) {
    for (const file of files) {
      db.prepare(`
        INSERT INTO files (id, work_id, user_id, filename, sanitized_filename, extension, size_bytes, storage_key, content_type, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(file.id, file.work_id, file.user_id, file.filename, file.sanitized_filename, file.extension, file.size_bytes, file.storage_key, file.content_type, file.created_at);
    }
  }
}

function restoreWork(db: any, data: any): void {
  const { work, files } = data;

  const subject = db.prepare('SELECT id FROM subjects WHERE id = ?').get(work.subject_id);
  if (!subject) {
    throw new Error('Parent subject no longer exists. Cannot restore.');
  }

  db.prepare(`
    INSERT INTO works (id, subject_id, user_id, title, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `).run(work.id, work.subject_id, work.user_id, work.title, work.created_at);

  if (files) {
    for (const file of files) {
      db.prepare(`
        INSERT INTO files (id, work_id, user_id, filename, sanitized_filename, extension, size_bytes, storage_key, content_type, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(file.id, file.work_id, file.user_id, file.filename, file.sanitized_filename, file.extension, file.size_bytes, file.storage_key, file.content_type, file.created_at);
    }
  }
}

function restoreFile(db: any, data: any): void {
  const { file } = data;

  const work = db.prepare('SELECT id FROM works WHERE id = ?').get(file.work_id);
  if (!work) {
    throw new Error('Parent work no longer exists. Cannot restore.');
  }

  db.prepare(`
    INSERT INTO files (id, work_id, user_id, filename, sanitized_filename, extension, size_bytes, storage_key, content_type, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(file.id, file.work_id, file.user_id, file.filename, file.sanitized_filename, file.extension, file.size_bytes, file.storage_key, file.content_type, file.created_at);
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
