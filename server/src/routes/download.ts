import type { FastifyInstance } from 'fastify';
import { getDatabase } from '../db/runtime.js';
import type { StorageAdapter } from '../storage/adapter.js';
import archiver from 'archiver';

export function createDownloadRoutes(storage: StorageAdapter) {
  return async function downloadRoutes(fastify: FastifyInstance): Promise<void> {
    // Download entire work as ZIP
    fastify.get<{ Params: { id: string } }>('/api/download/work/:id', async (request, reply) => {
      const db = getDatabase();
      const work = await db.get(`
        SELECT w.*, sub.name as subject_name, s.name as session_name
        FROM works w
        JOIN subjects sub ON w.subject_id = sub.id
        JOIN academic_sessions s ON sub.session_id = s.id
        WHERE w.id = ? AND w.user_id = ?
      `, [request.params.id, request.userId]) as any;

      if (!work) {
        return reply.status(404).send({ error: 'Work not found' });
      }

      const files = await db.all('SELECT * FROM files WHERE work_id = ?', [work.id]) as any[];

      if (files.length === 0) {
        return reply.status(404).send({ error: 'No files in this work' });
      }

      const zipName = `${work.title}.zip`;
      reply.header('Content-Type', 'application/zip');
      reply.header('Content-Disposition', `attachment; filename="${zipName}"`);

      const archive = archiver('zip', { zlib: { level: 5 } });
      reply.raw.on('close', () => archive.destroy());

      for (const file of files) {
        const { data } = await storage.download(file.storage_key);
        archive.append(data, { name: file.filename });
      }

      archive.finalize();
      return reply.send(archive);
    });

    // Download entire subject as ZIP
    fastify.get<{ Params: { id: string } }>('/api/download/subject/:id', async (request, reply) => {
      const db = getDatabase();
      const subject = await db.get(`
        SELECT sub.*, s.name as session_name
        FROM subjects sub
        JOIN academic_sessions s ON sub.session_id = s.id
        WHERE sub.id = ? AND sub.user_id = ?
      `, [request.params.id, request.userId]) as any;

      if (!subject) {
        return reply.status(404).send({ error: 'Subject not found' });
      }

      const works = await db.all('SELECT * FROM works WHERE subject_id = ?', [subject.id]) as any[];

      const zipName = `${subject.name}.zip`;
      reply.header('Content-Type', 'application/zip');
      reply.header('Content-Disposition', `attachment; filename="${zipName}"`);

      const archive = archiver('zip', { zlib: { level: 5 } });
      reply.raw.on('close', () => archive.destroy());

      for (const work of works) {
        const files = await db.all('SELECT * FROM files WHERE work_id = ?', [work.id]) as any[];
        for (const file of files) {
          const { data } = await storage.download(file.storage_key);
          archive.append(data, { name: `${work.title}/${file.filename}` });
        }
      }

      archive.finalize();
      return reply.send(archive);
    });

    // Download entire session as ZIP
    fastify.get<{ Params: { id: string } }>('/api/download/session/:id', async (request, reply) => {
      const db = getDatabase();
      const session = await db.get(
        'SELECT * FROM academic_sessions WHERE id = ? AND user_id = ?'
      , [request.params.id, request.userId]) as any;

      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      const subjects = await db.all('SELECT * FROM subjects WHERE session_id = ?', [session.id]) as any[];

      const zipName = `${session.name}.zip`;
      reply.header('Content-Type', 'application/zip');
      reply.header('Content-Disposition', `attachment; filename="${zipName}"`);

      const archive = archiver('zip', { zlib: { level: 5 } });
      reply.raw.on('close', () => archive.destroy());

      for (const subject of subjects) {
        const works = await db.all('SELECT * FROM works WHERE subject_id = ?', [subject.id]) as any[];
        for (const work of works) {
          const files = await db.all('SELECT * FROM files WHERE work_id = ?', [work.id]) as any[];
          for (const file of files) {
            const { data } = await storage.download(file.storage_key);
            archive.append(data, {
              name: `${subject.name}/${work.title}/${file.filename}`,
            });
          }
        }
      }

      archive.finalize();
      return reply.send(archive);
    });

    // Download entire account as ZIP
    fastify.get('/api/download/all', async (request, reply) => {
      const db = getDatabase();
      const sessions = await db.all(
        'SELECT * FROM academic_sessions WHERE user_id = ?'
      , [request.userId]) as any[];

      const zipName = 'labrepo-backup.zip';
      reply.header('Content-Type', 'application/zip');
      reply.header('Content-Disposition', `attachment; filename="${zipName}"`);

      const archive = archiver('zip', { zlib: { level: 5 } });
      reply.raw.on('close', () => archive.destroy());

      for (const session of sessions) {
        const subjects = await db.all('SELECT * FROM subjects WHERE session_id = ?', [session.id]) as any[];
        for (const subject of subjects) {
          const works = await db.all('SELECT * FROM works WHERE subject_id = ?', [subject.id]) as any[];
          for (const work of works) {
            const files = await db.all('SELECT * FROM files WHERE work_id = ?', [work.id]) as any[];
            for (const file of files) {
              const { data } = await storage.download(file.storage_key);
              archive.append(data, {
                name: `${session.name}/${subject.name}/${work.title}/${file.filename}`,
              });
            }
          }
        }
      }

      archive.finalize();
      return reply.send(archive);
    });
  };
}
