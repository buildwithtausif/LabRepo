import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { initDb, closeDb } from './db/index.js';
import { clerkAuth } from './auth/clerk.js';
import { MockS3Adapter } from './storage/mock-s3.js';
import { userRoutes } from './routes/user.js';
import { sessionRoutes } from './routes/sessions.js';
import { subjectRoutes } from './routes/subjects.js';
import { workRoutes } from './routes/works.js';
import { createFileRoutes } from './routes/files.js';
import { createDownloadRoutes } from './routes/download.js';
import { createRecycleBinRoutes } from './routes/recycle-bin.js';
import { searchRoutes } from './routes/search.js';
import { startCleanupJob } from './jobs/cleanup.js';

const PORT = parseInt(process.env.API_PORT || '3001', 10);
const HOST = process.env.API_HOST || '0.0.0.0';

async function start() {
  // Initialize database
  const db = initDb();
  console.log('[server] Database initialized');

  // Initialize storage adapter (mock S3 for development)
  const storage = new MockS3Adapter();
  console.log('[server] Storage adapter initialized (MockS3)');

  // Create Fastify instance
  const fastify = Fastify({
    logger: true,
  });

  // Custom JSON parser to safely handle empty bodies (avoids FST_ERR_CTP_EMPTY_JSON_BODY)
  fastify.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    try {
      if (!body || (body as string).trim() === '') {
        done(null, {});
      } else {
        done(null, JSON.parse(body as string));
      }
    } catch (err: any) {
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  // Register CORS
  await fastify.register(cors, {
    origin: [
      'http://localhost:4321',
      'http://localhost:3000',
      'http://127.0.0.1:4321',
      'http://127.0.0.1:3000',
    ],
    credentials: true,
  });

  // Register multipart support (for file uploads)
  await fastify.register(multipart, {
    limits: {
      fileSize: 25 * 1024 * 1024, // 25 MB
      files: 20, // max 20 files per request
    },
  });

  // Health check (no auth required)
  fastify.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  // Register auth plugin (all routes below require authentication)
  await fastify.register(clerkAuth);

  // Register routes
  await fastify.register(userRoutes);
  await fastify.register(sessionRoutes);
  await fastify.register(subjectRoutes);
  await fastify.register(workRoutes);
  await fastify.register(createFileRoutes(storage));
  await fastify.register(createDownloadRoutes(storage));
  await fastify.register(createRecycleBinRoutes(storage));
  await fastify.register(searchRoutes);

  // Start cleanup job
  startCleanupJob(storage);
  console.log('[server] Cleanup job started');

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[server] Shutting down...');
    await fastify.close();
    closeDb();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Start server
  try {
    await fastify.listen({ port: PORT, host: HOST });
    console.log(`[server] LabRepo API running at http://${HOST}:${PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();
