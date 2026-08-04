import type { FastifyInstance } from 'fastify';
import { getDatabase } from '../db/runtime.js';

interface CreateSubjectBody {
  name: string;
}

interface UpdateSubjectBody {
  name?: string;
}

export async function subjectRoutes(fastify: FastifyInstance): Promise<void> {
  // List subjects for a session
  fastify.get<{ Params: { sessionId: string } }>(
    '/api/sessions/:sessionId/subjects',
    async (request, reply) => {
      const db = getDatabase();

      // Verify session ownership
      const session = await db.get(
        'SELECT id FROM academic_sessions WHERE id = ? AND user_id = ?'
      , [request.params.sessionId, request.userId]);

      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      const subjects = await db.all(`
        SELECT s.*,
          (SELECT COUNT(*) FROM works WHERE subject_id = s.id) as work_count,
          (SELECT COUNT(*) FROM files f JOIN works w ON f.work_id = w.id WHERE w.subject_id = s.id) as file_count,
          (SELECT COALESCE(SUM(f.size_bytes), 0) FROM files f JOIN works w ON f.work_id = w.id WHERE w.subject_id = s.id) as total_size
        FROM subjects s
        WHERE s.session_id = ?
        ORDER BY s.name ASC
      `, [request.params.sessionId]);

      return { subjects };
    }
  );

  // Get a single subject
  fastify.get<{ Params: { id: string } }>('/api/subjects/:id', async (request, reply) => {
    const db = getDatabase();
    const subject = await db.get(`
      SELECT s.*,
        (SELECT name FROM academic_sessions WHERE id = s.session_id) as session_name,
        (SELECT id FROM academic_sessions WHERE id = s.session_id) as session_id,
        (SELECT COUNT(*) FROM works WHERE subject_id = s.id) as work_count,
        (SELECT COUNT(*) FROM files f JOIN works w ON f.work_id = w.id WHERE w.subject_id = s.id) as file_count,
        (SELECT COALESCE(SUM(f.size_bytes), 0) FROM files f JOIN works w ON f.work_id = w.id WHERE w.subject_id = s.id) as total_size
      FROM subjects s
      WHERE s.id = ? AND s.user_id = ?
    `, [request.params.id, request.userId]) as any;

    if (!subject) {
      return reply.status(404).send({ error: 'Subject not found' });
    }

    return { subject };
  });

  // Create subject
  fastify.post<{ Params: { sessionId: string }; Body: CreateSubjectBody }>(
    '/api/sessions/:sessionId/subjects',
    async (request, reply) => {
      const { name } = request.body;

      if (!name || !name.trim()) {
        return reply.status(400).send({ error: 'Subject name is required' });
      }

      const db = getDatabase();

      // Verify session ownership
      const session = await db.get(
        'SELECT id FROM academic_sessions WHERE id = ? AND user_id = ?'
      , [request.params.sessionId, request.userId]);

      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      // Check for duplicate
      const existing = await db.get(
        'SELECT id FROM subjects WHERE session_id = ? AND name = ?'
      , [request.params.sessionId, name.trim()]);

      if (existing) {
        return reply.status(409).send({ error: 'A subject with this name already exists in this session' });
      }

      const result = await db.run(
        'INSERT INTO subjects (session_id, user_id, name) VALUES (?, ?, ?)'
      , [request.params.sessionId, request.userId, name.trim()]);

      const subject = await db.get('SELECT * FROM subjects WHERE id = ?', [result.insertId]);
      return reply.status(201).send({ subject });
    }
  );

  // Batch create subjects (for onboarding)
  fastify.post<{ Params: { sessionId: string }; Body: { names: string[] } }>(
    '/api/sessions/:sessionId/subjects/batch',
    async (request, reply) => {
      const { names } = request.body;

      if (!names || !Array.isArray(names) || names.length === 0) {
        return reply.status(400).send({ error: 'At least one subject name is required' });
      }

      const db = getDatabase();

      // Verify session ownership
      const session = await db.get(
        'SELECT id FROM academic_sessions WHERE id = ? AND user_id = ?'
      , [request.params.sessionId, request.userId]);

      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      const created: any[] = [];
      const skipped: string[] = [];

      const batchInsert = async () => {
        for (const name of names) {
          const trimmed = name.trim();
          if (!trimmed) continue;

          const result = await db.run(
            'INSERT OR IGNORE INTO subjects (session_id, user_id, name) VALUES (?, ?, ?)'
          , [request.params.sessionId, request.userId, trimmed]);

          if (result.rowCount > 0) {
            const subject = await db.get('SELECT * FROM subjects WHERE session_id = ? AND name = ?', [request.params.sessionId, trimmed]);
            created.push(subject);
          } else {
            skipped.push(trimmed);
          }
        }
      };

      await db.transaction(batchInsert);
      return reply.status(201).send({ created, skipped });
    }
  );

  // Update subject
  fastify.patch<{ Params: { id: string }; Body: UpdateSubjectBody }>(
    '/api/subjects/:id',
    async (request, reply) => {
      const db = getDatabase();
      const subject = await db.get(
        'SELECT * FROM subjects WHERE id = ? AND user_id = ?'
      , [request.params.id, request.userId]) as any;

      if (!subject) {
        return reply.status(404).send({ error: 'Subject not found' });
      }

      const { name } = request.body;
      if (name !== undefined) {
        if (!name.trim()) {
          return reply.status(400).send({ error: 'Subject name cannot be empty' });
        }
        const duplicate = await db.get(
          'SELECT id FROM subjects WHERE session_id = ? AND name = ? AND id != ?'
        , [subject.session_id, name.trim(), request.params.id]);
        if (duplicate) {
          return reply.status(409).send({ error: 'A subject with this name already exists' });
        }
      }

      await db.run(`
        UPDATE subjects SET name = COALESCE(?, name), updated_at = datetime('now')
        WHERE id = ? AND user_id = ?
      `, [name?.trim() ?? null, request.params.id, request.userId]);

      const updated = await db.get('SELECT * FROM subjects WHERE id = ?', [request.params.id]);
      return { subject: updated };
    }
  );

  // Delete subject (soft delete)
  fastify.delete<{ Params: { id: string } }>('/api/subjects/:id', async (request, reply) => {
    const db = getDatabase();
    const subject = await db.get(
      'SELECT * FROM subjects WHERE id = ? AND user_id = ?'
    , [request.params.id, request.userId]) as any;

    if (!subject) {
      return reply.status(404).send({ error: 'Subject not found' });
    }

    const works = await db.all('SELECT * FROM works WHERE subject_id = ?', [subject.id]);
    const workIds = works.map((w: any) => w.id);
    let files: any[] = [];
    if (workIds.length > 0) {
      const placeholders = workIds.map(() => '?').join(',');
      files = await db.all(`SELECT * FROM files WHERE work_id IN (${placeholders})`, workIds);
    }

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const deleteTransaction = async () => {
      await db.run(`
        INSERT INTO recycle_bin (user_id, item_type, item_id, original_data, expires_at)
        VALUES (?, 'subject', ?, ?, ?)
      `, [request.userId, subject.id, JSON.stringify({ subject, works, files }), expiresAt]);

      await db.run('DELETE FROM subjects WHERE id = ?', [subject.id]);
    };

    await db.transaction(deleteTransaction);
    return { success: true, message: 'Subject moved to recycle bin' };
  });
}
