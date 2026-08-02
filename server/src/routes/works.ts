import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/index.js';

interface CreateWorkBody {
  title?: string;
}

interface UpdateWorkBody {
  title?: string;
}

export async function workRoutes(fastify: FastifyInstance): Promise<void> {
  // List works for a subject
  fastify.get<{ Params: { subjectId: string } }>(
    '/api/subjects/:subjectId/works',
    async (request, reply) => {
      const db = getDb();

      // Verify subject ownership
      const subject = db.prepare(
        'SELECT id FROM subjects WHERE id = ? AND user_id = ?'
      ).get(request.params.subjectId, request.userId);

      if (!subject) {
        return reply.status(404).send({ error: 'Subject not found' });
      }

      const works = db.prepare(`
        SELECT w.*,
          (SELECT COUNT(*) FROM files WHERE work_id = w.id) as file_count,
          (SELECT COALESCE(SUM(size_bytes), 0) FROM files WHERE work_id = w.id) as total_size
        FROM works w
        WHERE w.subject_id = ?
        ORDER BY w.created_at DESC
      `).all(request.params.subjectId);

      return { works };
    }
  );

  // Get a single work
  fastify.get<{ Params: { id: string } }>('/api/works/:id', async (request, reply) => {
    const db = getDb();
    const work = db.prepare(`
      SELECT w.*,
        sub.name as subject_name,
        sub.id as subject_id,
        s.name as session_name,
        s.id as session_id,
        (SELECT COUNT(*) FROM files WHERE work_id = w.id) as file_count,
        (SELECT COALESCE(SUM(size_bytes), 0) FROM files WHERE work_id = w.id) as total_size
      FROM works w
      JOIN subjects sub ON w.subject_id = sub.id
      JOIN academic_sessions s ON sub.session_id = s.id
      WHERE w.id = ? AND w.user_id = ?
    `).get(request.params.id, request.userId) as any;

    if (!work) {
      return reply.status(404).send({ error: 'Work not found' });
    }

    return { work };
  });

  // Create work
  fastify.post<{ Params: { subjectId: string }; Body: CreateWorkBody }>(
    '/api/subjects/:subjectId/works',
    async (request, reply) => {
      const db = getDb();

      // Verify subject ownership
      const subject = db.prepare(
        'SELECT id FROM subjects WHERE id = ? AND user_id = ?'
      ).get(request.params.subjectId, request.userId);

      if (!subject) {
        return reply.status(404).send({ error: 'Subject not found' });
      }

      // Default title = current date
      const title = request.body?.title?.trim() || new Date().toISOString().split('T')[0];

      const result = db.prepare(
        'INSERT INTO works (subject_id, user_id, title) VALUES (?, ?, ?)'
      ).run(request.params.subjectId, request.userId, title);

      const work = db.prepare('SELECT * FROM works WHERE id = ?').get(result.lastInsertRowid);
      return reply.status(201).send({ work });
    }
  );

  // Update work
  fastify.patch<{ Params: { id: string }; Body: UpdateWorkBody }>(
    '/api/works/:id',
    async (request, reply) => {
      const db = getDb();
      const work = db.prepare(
        'SELECT * FROM works WHERE id = ? AND user_id = ?'
      ).get(request.params.id, request.userId) as any;

      if (!work) {
        return reply.status(404).send({ error: 'Work not found' });
      }

      const { title } = request.body;
      if (title !== undefined && !title.trim()) {
        return reply.status(400).send({ error: 'Work title cannot be empty' });
      }

      db.prepare(`
        UPDATE works SET title = COALESCE(?, title), updated_at = datetime('now')
        WHERE id = ? AND user_id = ?
      `).run(title?.trim() ?? null, request.params.id, request.userId);

      const updated = db.prepare('SELECT * FROM works WHERE id = ?').get(request.params.id);
      return { work: updated };
    }
  );

  // Delete work (soft delete)
  fastify.delete<{ Params: { id: string } }>('/api/works/:id', async (request, reply) => {
    const db = getDb();
    const work = db.prepare(
      'SELECT * FROM works WHERE id = ? AND user_id = ?'
    ).get(request.params.id, request.userId) as any;

    if (!work) {
      return reply.status(404).send({ error: 'Work not found' });
    }

    const files = db.prepare('SELECT * FROM files WHERE work_id = ?').all(work.id);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const deleteTransaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO recycle_bin (user_id, item_type, item_id, original_data, expires_at)
        VALUES (?, 'work', ?, ?, ?)
      `).run(request.userId, work.id, JSON.stringify({ work, files }), expiresAt);

      db.prepare('DELETE FROM works WHERE id = ?').run(work.id);
    });

    deleteTransaction();
    return { success: true, message: 'Work moved to recycle bin' };
  });
}
