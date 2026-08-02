import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/index.js';

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
      const db = getDb();

      // Verify session ownership
      const session = db.prepare(
        'SELECT id FROM academic_sessions WHERE id = ? AND user_id = ?'
      ).get(request.params.sessionId, request.userId);

      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      const subjects = db.prepare(`
        SELECT s.*,
          (SELECT COUNT(*) FROM works WHERE subject_id = s.id) as work_count,
          (SELECT COUNT(*) FROM files f JOIN works w ON f.work_id = w.id WHERE w.subject_id = s.id) as file_count,
          (SELECT COALESCE(SUM(f.size_bytes), 0) FROM files f JOIN works w ON f.work_id = w.id WHERE w.subject_id = s.id) as total_size
        FROM subjects s
        WHERE s.session_id = ?
        ORDER BY s.name ASC
      `).all(request.params.sessionId);

      return { subjects };
    }
  );

  // Get a single subject
  fastify.get<{ Params: { id: string } }>('/api/subjects/:id', async (request, reply) => {
    const db = getDb();
    const subject = db.prepare(`
      SELECT s.*,
        (SELECT name FROM academic_sessions WHERE id = s.session_id) as session_name,
        (SELECT id FROM academic_sessions WHERE id = s.session_id) as session_id,
        (SELECT COUNT(*) FROM works WHERE subject_id = s.id) as work_count,
        (SELECT COUNT(*) FROM files f JOIN works w ON f.work_id = w.id WHERE w.subject_id = s.id) as file_count,
        (SELECT COALESCE(SUM(f.size_bytes), 0) FROM files f JOIN works w ON f.work_id = w.id WHERE w.subject_id = s.id) as total_size
      FROM subjects s
      WHERE s.id = ? AND s.user_id = ?
    `).get(request.params.id, request.userId) as any;

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

      const db = getDb();

      // Verify session ownership
      const session = db.prepare(
        'SELECT id FROM academic_sessions WHERE id = ? AND user_id = ?'
      ).get(request.params.sessionId, request.userId);

      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      // Check for duplicate
      const existing = db.prepare(
        'SELECT id FROM subjects WHERE session_id = ? AND name = ?'
      ).get(request.params.sessionId, name.trim());

      if (existing) {
        return reply.status(409).send({ error: 'A subject with this name already exists in this session' });
      }

      const result = db.prepare(
        'INSERT INTO subjects (session_id, user_id, name) VALUES (?, ?, ?)'
      ).run(request.params.sessionId, request.userId, name.trim());

      const subject = db.prepare('SELECT * FROM subjects WHERE id = ?').get(result.lastInsertRowid);
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

      const db = getDb();

      // Verify session ownership
      const session = db.prepare(
        'SELECT id FROM academic_sessions WHERE id = ? AND user_id = ?'
      ).get(request.params.sessionId, request.userId);

      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      const created: any[] = [];
      const skipped: string[] = [];

      const insertSubject = db.prepare(
        'INSERT OR IGNORE INTO subjects (session_id, user_id, name) VALUES (?, ?, ?)'
      );

      const batchInsert = db.transaction(() => {
        for (const name of names) {
          const trimmed = name.trim();
          if (!trimmed) continue;

          const result = insertSubject.run(request.params.sessionId, request.userId, trimmed);
          if (result.changes > 0) {
            const subject = db.prepare('SELECT * FROM subjects WHERE id = ?').get(result.lastInsertRowid);
            created.push(subject);
          } else {
            skipped.push(trimmed);
          }
        }
      });

      batchInsert();
      return reply.status(201).send({ created, skipped });
    }
  );

  // Update subject
  fastify.patch<{ Params: { id: string }; Body: UpdateSubjectBody }>(
    '/api/subjects/:id',
    async (request, reply) => {
      const db = getDb();
      const subject = db.prepare(
        'SELECT * FROM subjects WHERE id = ? AND user_id = ?'
      ).get(request.params.id, request.userId) as any;

      if (!subject) {
        return reply.status(404).send({ error: 'Subject not found' });
      }

      const { name } = request.body;
      if (name !== undefined) {
        if (!name.trim()) {
          return reply.status(400).send({ error: 'Subject name cannot be empty' });
        }
        const duplicate = db.prepare(
          'SELECT id FROM subjects WHERE session_id = ? AND name = ? AND id != ?'
        ).get(subject.session_id, name.trim(), request.params.id);
        if (duplicate) {
          return reply.status(409).send({ error: 'A subject with this name already exists' });
        }
      }

      db.prepare(`
        UPDATE subjects SET name = COALESCE(?, name), updated_at = datetime('now')
        WHERE id = ? AND user_id = ?
      `).run(name?.trim() ?? null, request.params.id, request.userId);

      const updated = db.prepare('SELECT * FROM subjects WHERE id = ?').get(request.params.id);
      return { subject: updated };
    }
  );

  // Delete subject (soft delete)
  fastify.delete<{ Params: { id: string } }>('/api/subjects/:id', async (request, reply) => {
    const db = getDb();
    const subject = db.prepare(
      'SELECT * FROM subjects WHERE id = ? AND user_id = ?'
    ).get(request.params.id, request.userId) as any;

    if (!subject) {
      return reply.status(404).send({ error: 'Subject not found' });
    }

    const works = db.prepare('SELECT * FROM works WHERE subject_id = ?').all(subject.id);
    const workIds = works.map((w: any) => w.id);
    let files: any[] = [];
    if (workIds.length > 0) {
      const placeholders = workIds.map(() => '?').join(',');
      files = db.prepare(`SELECT * FROM files WHERE work_id IN (${placeholders})`).all(...workIds);
    }

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const deleteTransaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO recycle_bin (user_id, item_type, item_id, original_data, expires_at)
        VALUES (?, 'subject', ?, ?, ?)
      `).run(request.userId, subject.id, JSON.stringify({ subject, works, files }), expiresAt);

      db.prepare('DELETE FROM subjects WHERE id = ?').run(subject.id);
    });

    deleteTransaction();
    return { success: true, message: 'Subject moved to recycle bin' };
  });
}
