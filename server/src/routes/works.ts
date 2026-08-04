import type { FastifyInstance } from 'fastify';
import { getDatabase } from '../db/runtime.js';

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
      const db = getDatabase();

      // Verify subject ownership
      const subject = await db.get(
        'SELECT id FROM subjects WHERE id = ? AND user_id = ?'
      , [request.params.subjectId, request.userId]);

      if (!subject) {
        return reply.status(404).send({ error: 'Subject not found' });
      }

      const works = await db.all(`
        SELECT w.*,
          (SELECT COUNT(*) FROM files WHERE work_id = w.id) as file_count,
          (SELECT COALESCE(SUM(size_bytes), 0) FROM files WHERE work_id = w.id) as total_size
        FROM works w
        WHERE w.subject_id = ?
        ORDER BY w.created_at DESC
      `, [request.params.subjectId]);

      return { works };
    }
  );

  // Get a single work
  fastify.get<{ Params: { id: string } }>('/api/works/:id', async (request, reply) => {
    const db = getDatabase();
    const work = await db.get(`
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
    `, [request.params.id, request.userId]) as any;

    if (!work) {
      return reply.status(404).send({ error: 'Work not found' });
    }

    return { work };
  });

  // Create work
  fastify.post<{ Params: { subjectId: string }; Body: CreateWorkBody }>(
    '/api/subjects/:subjectId/works',
    async (request, reply) => {
      const db = getDatabase();

      // Default title = current date
      const title = request.body?.title?.trim() || new Date().toISOString().split('T')[0];

      const work = await db.get(
        `
          INSERT INTO works (subject_id, user_id, title)
          SELECT ?, ?, ?
          WHERE EXISTS (
            SELECT 1 FROM subjects WHERE id = ? AND user_id = ?
          )
          RETURNING *
        `,
        [request.params.subjectId, request.userId, title, request.params.subjectId, request.userId]
      ) as any;

      if (!work) {
        return reply.status(404).send({ error: 'Subject not found' });
      }

      return reply.status(201).send({ work });
    }
  );

  // Update work
  fastify.patch<{ Params: { id: string }; Body: UpdateWorkBody }>(
    '/api/works/:id',
    async (request, reply) => {
      const db = getDatabase();
      const work = await db.get(
        'SELECT * FROM works WHERE id = ? AND user_id = ?'
      , [request.params.id, request.userId]) as any;

      if (!work) {
        return reply.status(404).send({ error: 'Work not found' });
      }

      const { title } = request.body;
      if (title !== undefined && !title.trim()) {
        return reply.status(400).send({ error: 'Work title cannot be empty' });
      }

      const updated = await db.get(`
        UPDATE works
        SET title = COALESCE(?, title), updated_at = datetime('now')
        WHERE id = ? AND user_id = ?
        RETURNING *
      `, [title?.trim() ?? null, request.params.id, request.userId]);
      return { work: updated };
    }
  );

  // Delete work (soft delete)
  fastify.delete<{ Params: { id: string } }>('/api/works/:id', async (request, reply) => {
    const db = getDatabase();
    const work = await db.get(
      'SELECT * FROM works WHERE id = ? AND user_id = ?'
    , [request.params.id, request.userId]) as any;

    if (!work) {
      return reply.status(404).send({ error: 'Work not found' });
    }

    const files = await db.all('SELECT * FROM files WHERE work_id = ?', [work.id]);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const deleteTransaction = async () => {
      await db.run(`
        INSERT INTO recycle_bin (user_id, item_type, item_id, original_data, expires_at)
        VALUES (?, 'work', ?, ?, ?)
      `, [request.userId, work.id, JSON.stringify({ work, files }), expiresAt]);

      await db.run('DELETE FROM works WHERE id = ?', [work.id]);
    };

    await db.transaction(deleteTransaction);
    return { success: true, message: 'Work moved to recycle bin' };
  });
}
