import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/index.js';

interface SearchQuery {
  q?: string;
  sort?: 'newest' | 'oldest' | 'a-z' | 'z-a' | 'recently-updated';
  session_id?: string;
  subject_id?: string;
  extension?: string;
  date_from?: string;
  date_to?: string;
}

export async function searchRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Querystring: SearchQuery }>('/api/search', async (request) => {
    const db = getDb();
    const { q, sort, session_id, subject_id, extension, date_from, date_to } = request.query;

    const conditions: string[] = ['f.user_id = ?'];
    const params: any[] = [request.userId];

    // Text search across subjects, work titles, and filenames
    if (q && q.trim()) {
      const searchTerm = `%${q.trim()}%`;
      conditions.push(`(
        f.filename LIKE ? OR 
        w.title LIKE ? OR 
        sub.name LIKE ?
      )`);
      params.push(searchTerm, searchTerm, searchTerm);
    }

    // Filter by session
    if (session_id) {
      conditions.push('s.id = ?');
      params.push(session_id);
    }

    // Filter by subject
    if (subject_id) {
      conditions.push('sub.id = ?');
      params.push(subject_id);
    }

    // Filter by extension
    if (extension) {
      conditions.push('f.extension = ?');
      params.push(extension.toLowerCase().replace('.', ''));
    }

    // Filter by date range
    if (date_from) {
      conditions.push('f.created_at >= ?');
      params.push(date_from);
    }
    if (date_to) {
      conditions.push('f.created_at <= ?');
      params.push(date_to);
    }

    // Sorting
    let orderBy = 'f.created_at DESC'; // default: newest
    switch (sort) {
      case 'oldest':
        orderBy = 'f.created_at ASC';
        break;
      case 'a-z':
        orderBy = 'f.filename ASC';
        break;
      case 'z-a':
        orderBy = 'f.filename DESC';
        break;
      case 'recently-updated':
        orderBy = 'w.updated_at DESC';
        break;
    }

    const whereClause = conditions.join(' AND ');

    const results = db.prepare(`
      SELECT 
        f.id, f.filename, f.extension, f.size_bytes, f.created_at,
        w.id as work_id, w.title as work_title,
        sub.id as subject_id, sub.name as subject_name,
        s.id as session_id, s.name as session_name
      FROM files f
      JOIN works w ON f.work_id = w.id
      JOIN subjects sub ON w.subject_id = sub.id
      JOIN academic_sessions s ON sub.session_id = s.id
      WHERE ${whereClause}
      ORDER BY ${orderBy}
      LIMIT 100
    `).all(...params);

    // Also search for matching works (even without files)
    const workConditions: string[] = ['w.user_id = ?'];
    const workParams: any[] = [request.userId];

    if (q && q.trim()) {
      const searchTerm = `%${q.trim()}%`;
      workConditions.push('(w.title LIKE ? OR sub.name LIKE ?)');
      workParams.push(searchTerm, searchTerm);
    }

    if (session_id) {
      workConditions.push('s.id = ?');
      workParams.push(session_id);
    }

    if (subject_id) {
      workConditions.push('sub.id = ?');
      workParams.push(subject_id);
    }

    const workWhereClause = workConditions.join(' AND ');

    const workResults = db.prepare(`
      SELECT 
        w.id, w.title, w.created_at, w.updated_at,
        sub.id as subject_id, sub.name as subject_name,
        s.id as session_id, s.name as session_name,
        (SELECT COUNT(*) FROM files WHERE work_id = w.id) as file_count
      FROM works w
      JOIN subjects sub ON w.subject_id = sub.id
      JOIN academic_sessions s ON sub.session_id = s.id
      WHERE ${workWhereClause}
      ORDER BY w.updated_at DESC
      LIMIT 50
    `).all(...workParams);

    return { files: results, works: workResults };
  });

  // Get available filter options for the user
  fastify.get('/api/search/filters', async (request) => {
    const db = getDb();

    const sessions = db.prepare(
      'SELECT id, name FROM academic_sessions WHERE user_id = ? ORDER BY name'
    ).all(request.userId);

    const subjects = db.prepare(
      'SELECT id, name, session_id FROM subjects WHERE user_id = ? ORDER BY name'
    ).all(request.userId);

    const extensions = db.prepare(`
      SELECT DISTINCT extension FROM files WHERE user_id = ? ORDER BY extension
    `).all(request.userId) as any[];

    return {
      sessions,
      subjects,
      extensions: extensions.map((e: any) => e.extension),
    };
  });
}
