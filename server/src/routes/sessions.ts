import type { FastifyInstance } from 'fastify';
import { getDatabase } from '../db/runtime.js';

interface CreateSessionBody {
  name: string;
  auto_delete?: boolean;
  auto_delete_date?: string;
}

interface UpdateSessionBody {
  name?: string;
  auto_delete?: boolean;
  auto_delete_date?: string;
}

export async function sessionRoutes(fastify: FastifyInstance): Promise<void> {
  // List all academic sessions for the user
  fastify.get('/api/sessions', async (request) => {
    const db = getDatabase();
    const sessions = await db.all(`
      SELECT s.*, 
        (SELECT COUNT(*) FROM subjects WHERE session_id = s.id) as subject_count,
        (SELECT COUNT(*) FROM files f 
         JOIN works w ON f.work_id = w.id 
         JOIN subjects sub ON w.subject_id = sub.id 
         WHERE sub.session_id = s.id) as file_count
      FROM academic_sessions s 
      WHERE s.user_id = ? 
      ORDER BY s.created_at DESC
    `, [request.userId]);

    return { sessions };
  });

  // Get a single session
  fastify.get<{ Params: { id: string } }>('/api/sessions/:id', async (request, reply) => {
    const db = getDatabase();
    const session = await db.get(`
      SELECT s.*,
        (SELECT COUNT(*) FROM subjects WHERE session_id = s.id) as subject_count,
        (SELECT COUNT(*) FROM files f 
         JOIN works w ON f.work_id = w.id 
         JOIN subjects sub ON w.subject_id = sub.id 
         WHERE sub.session_id = s.id) as file_count
      FROM academic_sessions s 
      WHERE s.id = ? AND s.user_id = ?
    `, [request.params.id, request.userId]) as any;

    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    return { session };
  });

  // Create academic session
  fastify.post<{ Body: CreateSessionBody }>('/api/sessions', async (request, reply) => {
    const { name, auto_delete, auto_delete_date } = request.body;

    if (!name || !name.trim()) {
      return reply.status(400).send({ error: 'Session name is required' });
    }

    const db = getDatabase();

    // Check for duplicate name
    const existing = await db.get(
      'SELECT id FROM academic_sessions WHERE user_id = ? AND name = ?'
    , [request.userId, name.trim()]);

    if (existing) {
      return reply.status(409).send({ error: 'A session with this name already exists' });
    }

    // Default auto_delete_date: July 31 of the end year if session looks like "YYYY-YYYY"
    let deleteDate = auto_delete_date || null;
    if (auto_delete && !deleteDate) {
      const yearMatch = name.match(/(\d{4})\s*[-–]\s*(\d{4})/);
      if (yearMatch) {
        deleteDate = `${yearMatch[2]}-07-31`;
      }
    }

    const result = await db.run(`
      INSERT INTO academic_sessions (user_id, name, auto_delete, auto_delete_date) 
      VALUES (?, ?, ?, ?)
    `, [request.userId, name.trim(), auto_delete ? 1 : 0, deleteDate]);

    const session = await db.get('SELECT * FROM academic_sessions WHERE id = ?', [result.insertId]);

    return reply.status(201).send({ session });
  });

  // Update academic session
  fastify.patch<{ Params: { id: string }; Body: UpdateSessionBody }>(
    '/api/sessions/:id',
    async (request, reply) => {
      const db = getDatabase();
      const session = await db.get(
        'SELECT * FROM academic_sessions WHERE id = ? AND user_id = ?'
      , [request.params.id, request.userId]) as any;

      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      const { name, auto_delete, auto_delete_date } = request.body;

      if (name !== undefined) {
        if (!name.trim()) {
          return reply.status(400).send({ error: 'Session name cannot be empty' });
        }
        const duplicate = await db.get(
          'SELECT id FROM academic_sessions WHERE user_id = ? AND name = ? AND id != ?'
        , [request.userId, name.trim(), request.params.id]);
        if (duplicate) {
          return reply.status(409).send({ error: 'A session with this name already exists' });
        }
      }

      await db.run(`
        UPDATE academic_sessions 
        SET name = COALESCE(?, name),
            auto_delete = COALESCE(?, auto_delete),
            auto_delete_date = COALESCE(?, auto_delete_date),
          updated_at = datetime('now')
        WHERE id = ? AND user_id = ?
      `, [
        name?.trim() ?? null,
        auto_delete !== undefined ? (auto_delete ? 1 : 0) : null,
        auto_delete_date ?? null,
        request.params.id,
        request.userId
      ]);

      const updated = await db.get('SELECT * FROM academic_sessions WHERE id = ?', [request.params.id]);
      return { session: updated };
    }
  );

  // Delete academic session (soft delete → recycle bin)
  fastify.delete<{ Params: { id: string } }>('/api/sessions/:id', async (request, reply) => {
    const db = getDatabase();
    const session = await db.get(
      'SELECT * FROM academic_sessions WHERE id = ? AND user_id = ?'
    , [request.params.id, request.userId]) as any;

    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    // Gather all related data for recycle bin
    const subjects = await db.all('SELECT * FROM subjects WHERE session_id = ?', [session.id]);
    const subjectIds = subjects.map((s: any) => s.id);
    
    let works: any[] = [];
    let files: any[] = [];
    if (subjectIds.length > 0) {
      const placeholders = subjectIds.map(() => '?').join(',');
      works = await db.all(`SELECT * FROM works WHERE subject_id IN (${placeholders})`, subjectIds);
      const workIds = works.map((w: any) => w.id);
      if (workIds.length > 0) {
        const wPlaceholders = workIds.map(() => '?').join(',');
        files = await db.all(`SELECT * FROM files WHERE work_id IN (${wPlaceholders})`, workIds);
      }
    }

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const deleteTransaction = async () => {
      // Store in recycle bin
      await db.run(`
        INSERT INTO recycle_bin (user_id, item_type, item_id, original_data, expires_at)
        VALUES (?, 'session', ?, ?, ?)
      `, [
        request.userId,
        session.id,
        JSON.stringify({ session, subjects, works, files }),
        expiresAt
      ]);

      // Delete from main tables (cascading)
      await db.run('DELETE FROM academic_sessions WHERE id = ?', [session.id]);
    };

    await db.transaction(deleteTransaction);
    return { success: true, message: 'Session moved to recycle bin' };
  });
}
