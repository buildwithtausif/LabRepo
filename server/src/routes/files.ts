import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/index.js';
import type { StorageAdapter } from '../storage/adapter.js';
import { buildStorageKey } from '../storage/adapter.js';

// Allowed file extensions (programming / AI / data science / docs)
const ALLOWED_EXTENSIONS = new Set([
  'py', 'ipynb', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'c', 'cpp', 'h', 'hpp', 'java', 'kt', 'cs',
  'go', 'rs', 'swift', 'php', 'rb', 'r', 'scala', 'sql', 'html', 'css',
  'scss', 'json', 'yaml', 'yml', 'xml', 'md', 'txt', 'csv', 'parquet',
  'feather', 'pkl', 'joblib', 'onnx', 'pt', 'pth', 'keras', 'h5',
  'env', 'sh', 'bat', 'ps1', 'toml', 'ini', 'cfg', 'conf', 'log', 'dockerfile',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'rtf', 'tex'
]);

// Text-based extensions that support preview
const TEXT_EXTENSIONS = new Set([
  'py', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'c', 'cpp', 'h', 'hpp', 'java', 'kt', 'cs', 'go',
  'rs', 'swift', 'php', 'rb', 'r', 'scala', 'sql', 'html', 'css', 'scss',
  'json', 'yaml', 'yml', 'xml', 'md', 'txt', 'csv',
  'env', 'sh', 'bat', 'ps1', 'toml', 'ini', 'cfg', 'conf', 'log', 'dockerfile', 'tex', 'rtf'
]);

const MAX_UPLOAD_SIZE = 25 * 1024 * 1024; // 25 MB

/**
 * Sanitize a filename — remove dangerous characters, preserve extension.
 */
function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\.{2,}/g, '.')
    .trim()
    .replace(/^\.+/, '_');
}

/**
 * Get file extension from filename.
 */
function getExtension(filename: string): string {
  const parts = filename.split('.');
  if (parts.length < 2) return '';
  return parts[parts.length - 1].toLowerCase();
}

/**
 * Get content type based on file extension.
 */
function getContentType(ext: string): string {
  const types: Record<string, string> = {
    'py': 'text/x-python', 'js': 'text/javascript', 'mjs': 'text/javascript', 'cjs': 'text/javascript', 'jsx': 'text/jsx',
    'ts': 'text/typescript', 'tsx': 'text/tsx', 'c': 'text/x-c', 'h': 'text/x-c', 'hpp': 'text/x-c++src',
    'cpp': 'text/x-c++src', 'java': 'text/x-java', 'kt': 'text/x-kotlin',
    'cs': 'text/x-csharp', 'go': 'text/x-go', 'rs': 'text/x-rust',
    'swift': 'text/x-swift', 'php': 'text/x-php', 'rb': 'text/x-ruby',
    'r': 'text/x-r', 'scala': 'text/x-scala', 'sql': 'text/x-sql',
    'html': 'text/html', 'css': 'text/css', 'scss': 'text/x-scss',
    'json': 'application/json', 'yaml': 'text/yaml', 'yml': 'text/yaml',
    'xml': 'application/xml', 'md': 'text/markdown', 'txt': 'text/plain',
    'csv': 'text/csv', 'ipynb': 'application/x-ipynb+json',
    'env': 'text/plain', 'sh': 'application/x-sh', 'bat': 'application/x-msdownload', 'ps1': 'text/plain',
    'toml': 'text/plain', 'ini': 'text/plain', 'cfg': 'text/plain', 'conf': 'text/plain', 'log': 'text/plain', 'dockerfile': 'text/plain',
    'pdf': 'application/pdf',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xls': 'application/vnd.ms-excel',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'ppt': 'application/vnd.ms-powerpoint',
    'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'rtf': 'application/rtf',
    'tex': 'application/x-tex'
  };
  return types[ext] || 'application/octet-stream';
}

export function createFileRoutes(storage: StorageAdapter) {
  return async function fileRoutes(fastify: FastifyInstance): Promise<void> {
    // Upload files to a work
    fastify.post<{ Params: { workId: string } }>(
      '/api/works/:workId/files',
      async (request, reply) => {
        const db = getDb();

        // Verify work ownership and get path info
        const work = db.prepare(`
          SELECT w.*, sub.name as subject_name, s.name as session_name
          FROM works w
          JOIN subjects sub ON w.subject_id = sub.id
          JOIN academic_sessions s ON sub.session_id = s.id
          WHERE w.id = ? AND w.user_id = ?
        `).get(request.params.workId, request.userId) as any;

        if (!work) {
          return reply.status(404).send({ error: 'Work not found' });
        }

        const parts = request.parts();
        const uploadedFiles: any[] = [];
        let totalSize = 0;

        for await (const part of parts) {
          if (part.type !== 'file') continue;

          const filename = part.filename;
          if (!filename) continue;

          const ext = getExtension(filename);
          if (!ALLOWED_EXTENSIONS.has(ext)) {
            return reply.status(400).send({
              error: `Unsupported file extension: .${ext}`,
              allowed: Array.from(ALLOWED_EXTENSIONS),
            });
          }

          // Read file data
          const chunks: Buffer[] = [];
          for await (const chunk of part.file) {
            chunks.push(chunk);
          }
          const data = Buffer.concat(chunks);

          totalSize += data.length;
          if (totalSize > MAX_UPLOAD_SIZE) {
            return reply.status(400).send({
              error: `Total upload size exceeds 25 MB limit (current: ${(totalSize / 1024 / 1024).toFixed(1)} MB)`,
            });
          }

          const sanitized = sanitizeFilename(filename);
          const storageKey = buildStorageKey(
            request.userId,
            work.session_name,
            work.subject_name,
            work.title,
            sanitized
          );
          const contentType = getContentType(ext);

          // Upload to storage
          await storage.upload(storageKey, data, contentType);

          // Store metadata in DB
          const result = db.prepare(`
            INSERT INTO files (work_id, user_id, filename, sanitized_filename, extension, size_bytes, storage_key, content_type)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            request.params.workId, request.userId,
            filename, sanitized, ext, data.length,
            storageKey, contentType
          );

          const file = db.prepare('SELECT * FROM files WHERE id = ?').get(result.lastInsertRowid);
          uploadedFiles.push(file);
        }

        if (uploadedFiles.length === 0) {
          return reply.status(400).send({ error: 'No files were uploaded' });
        }

        // Update work timestamp
        db.prepare("UPDATE works SET updated_at = datetime('now') WHERE id = ?").run(request.params.workId);

        return reply.status(201).send({ files: uploadedFiles, count: uploadedFiles.length });
      }
    );

    // List files for a work
    fastify.get<{ Params: { workId: string } }>(
      '/api/works/:workId/files',
      async (request, reply) => {
        const db = getDb();

        const work = db.prepare(
          'SELECT id FROM works WHERE id = ? AND user_id = ?'
        ).get(request.params.workId, request.userId);

        if (!work) {
          return reply.status(404).send({ error: 'Work not found' });
        }

        const files = db.prepare(
          'SELECT * FROM files WHERE work_id = ? ORDER BY created_at DESC'
        ).all(request.params.workId);

        return { files };
      }
    );

    // Download a single file
    fastify.get<{ Params: { id: string } }>('/api/files/:id', async (request, reply) => {
      const db = getDb();
      const file = db.prepare(
        'SELECT * FROM files WHERE id = ? AND user_id = ?'
      ).get(request.params.id, request.userId) as any;

      if (!file) {
        return reply.status(404).send({ error: 'File not found' });
      }

      const { data, contentType } = await storage.download(file.storage_key);

      return reply
        .header('Content-Type', contentType)
        .header('Content-Disposition', `attachment; filename="${file.filename}"`)
        .header('Content-Length', data.length)
        .send(data);
    });

    // Preview a file (text-based only)
    fastify.get<{ Params: { id: string } }>('/api/files/:id/preview', async (request, reply) => {
      const db = getDb();
      const file = db.prepare(
        'SELECT * FROM files WHERE id = ? AND user_id = ?'
      ).get(request.params.id, request.userId) as any;

      if (!file) {
        return reply.status(404).send({ error: 'File not found' });
      }

      if (!TEXT_EXTENSIONS.has(file.extension)) {
        return reply.status(400).send({
          error: 'Preview is only available for text-based files',
          downloadOnly: true,
        });
      }

      const { data } = await storage.download(file.storage_key);
      const content = data.toString('utf-8');

      return {
        file: {
          id: file.id,
          filename: file.filename,
          extension: file.extension,
          size_bytes: file.size_bytes,
        },
        content,
        language: file.extension,
      };
    });

    // Delete a single file (soft delete)
    fastify.delete<{ Params: { id: string } }>('/api/files/:id', async (request, reply) => {
      const db = getDb();
      const file = db.prepare(
        'SELECT * FROM files WHERE id = ? AND user_id = ?'
      ).get(request.params.id, request.userId) as any;

      if (!file) {
        return reply.status(404).send({ error: 'File not found' });
      }

      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      const deleteTransaction = db.transaction(() => {
        db.prepare(`
          INSERT INTO recycle_bin (user_id, item_type, item_id, original_data, expires_at)
          VALUES (?, 'file', ?, ?, ?)
        `).run(request.userId, file.id, JSON.stringify({ file }), expiresAt);

        db.prepare('DELETE FROM files WHERE id = ?').run(file.id);
      });

      deleteTransaction();
      return { success: true, message: 'File moved to recycle bin' };
    });
  };
}
