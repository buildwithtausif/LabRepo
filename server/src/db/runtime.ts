import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Pool, type PoolClient } from 'pg';
import { initializeSchema } from './schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SQLITE_DB_PATH = path.join(__dirname, '..', '..', 'data', 'labrepo.db');

export interface QueryResult<T = Record<string, any>> {
  rows: T[];
  rowCount: number;
  insertId?: number | string | null;
}

export interface DatabaseClient {
  all<T = Record<string, any>>(query: string, params?: unknown[]): Promise<T[]>;
  get<T = Record<string, any>>(query: string, params?: unknown[]): Promise<T | undefined>;
  run(query: string, params?: unknown[]): Promise<QueryResult>;
  exec(query: string): Promise<void>;
  transaction<T>(callback: (client: DatabaseClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

type Driver = 'postgres' | 'sqlite';

let currentDb: DatabaseClient | undefined;
let currentDriver: Driver | undefined;

class SqliteDatabaseClient implements DatabaseClient {
  constructor(private readonly db: Database.Database) {}

  async all<T = Record<string, any>>(query: string, params: unknown[] = []): Promise<T[]> {
    return this.db.prepare(query).all(...params) as T[];
  }

  async get<T = Record<string, any>>(query: string, params: unknown[] = []): Promise<T | undefined> {
    return (this.db.prepare(query).get(...params) as T | undefined) ?? undefined;
  }

  async run(query: string, params: unknown[] = []): Promise<QueryResult> {
    const result = this.db.prepare(query).run(...params);
    return {
      rows: [],
      rowCount: result.changes,
      insertId: Number(result.lastInsertRowid),
    };
  }

  async exec(query: string): Promise<void> {
    this.db.exec(query);
  }

  async transaction<T>(callback: (client: DatabaseClient) => Promise<T>): Promise<T> {
    this.db.exec('BEGIN');
    try {
      const result = await callback(this);
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

class PostgresDatabaseClient implements DatabaseClient {
  constructor(private readonly pool: Pool, private readonly client?: PoolClient) {}

  private async query<T = Record<string, any>>(query: string, params: unknown[] = []): Promise<QueryResult<T>> {
    const prepared = prepareSql(query, params);
    const executor = this.client ?? this.pool;
    const result = await executor.query(prepared.text, prepared.values);

    return {
      rows: result.rows as T[],
      rowCount: result.rowCount ?? result.rows.length,
      insertId: (result.rows[0] as any)?.id ?? null,
    };
  }

  async all<T = Record<string, any>>(query: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.query<T>(query, params);
    return result.rows;
  }

  async get<T = Record<string, any>>(query: string, params: unknown[] = []): Promise<T | undefined> {
    const result = await this.query<T>(query, params);
    return result.rows[0];
  }

  async run(query: string, params: unknown[] = []): Promise<QueryResult> {
    return this.query(query, params);
  }

  async exec(query: string): Promise<void> {
    await (this.client ?? this.pool).query(query);
  }

  async transaction<T>(callback: (client: DatabaseClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const tx = new PostgresDatabaseClient(this.pool, client);

    try {
      await client.query('BEGIN');
      const result = await callback(tx);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    if (!this.client) {
      await this.pool.end();
    }
  }
}

function prepareSql(query: string, params: unknown[]): { text: string; values: unknown[] } {
  let statement = query.trim().replace(/;\s*$/, '');
  const isInsertIgnore = /INSERT\s+OR\s+IGNORE\s+INTO/i.test(statement);
  if (isInsertIgnore) {
    statement = statement.replace(/INSERT\s+OR\s+IGNORE\s+INTO/i, 'INSERT INTO');
  }

  statement = statement.replace(/datetime\('now'\)/gi, 'now_iso()');

  let placeholderIndex = 0;
  statement = statement.replace(/\?/g, () => `$${++placeholderIndex}`);

  if (isInsertIgnore && !/ON\s+CONFLICT/i.test(statement)) {
    statement = `${statement} ON CONFLICT DO NOTHING`;
  }

  if (/^INSERT\b/i.test(statement) && !/RETURNING\b/i.test(statement)) {
    statement = `${statement} RETURNING id`;
  }

  return {
    text: statement,
    values: params,
  };
}

async function ensurePostgresSchema(client: DatabaseClient): Promise<void> {
  await client.exec(`
    CREATE OR REPLACE FUNCTION now_iso() RETURNS text
    LANGUAGE SQL
    AS $$
      SELECT to_char(timezone('utc', now()), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    $$;
  `);

  await client.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      clerk_id TEXT NOT NULL UNIQUE,
      onboarding_completed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT now_iso(),
      updated_at TEXT NOT NULL DEFAULT now_iso()
    );

    CREATE TABLE IF NOT EXISTS academic_sessions (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      auto_delete INTEGER NOT NULL DEFAULT 0,
      auto_delete_date TEXT,
      created_at TEXT NOT NULL DEFAULT now_iso(),
      updated_at TEXT NOT NULL DEFAULT now_iso(),
      UNIQUE(user_id, name)
    );

    CREATE TABLE IF NOT EXISTS subjects (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      session_id INTEGER NOT NULL REFERENCES academic_sessions(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT now_iso(),
      updated_at TEXT NOT NULL DEFAULT now_iso(),
      UNIQUE(session_id, name)
    );

    CREATE TABLE IF NOT EXISTS works (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT now_iso(),
      updated_at TEXT NOT NULL DEFAULT now_iso()
    );

    CREATE TABLE IF NOT EXISTS files (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      sanitized_filename TEXT NOT NULL,
      extension TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      storage_key TEXT NOT NULL,
      content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      created_at TEXT NOT NULL DEFAULT now_iso()
    );

    CREATE TABLE IF NOT EXISTS recycle_bin (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      user_id TEXT NOT NULL,
      item_type TEXT NOT NULL CHECK(item_type IN ('session', 'subject', 'work', 'file')),
      item_id INTEGER NOT NULL,
      original_data TEXT NOT NULL,
      deleted_at TEXT NOT NULL DEFAULT now_iso(),
      expires_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user ON academic_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_subjects_session ON subjects(session_id);
    CREATE INDEX IF NOT EXISTS idx_subjects_user ON subjects(user_id);
    CREATE INDEX IF NOT EXISTS idx_works_subject ON works(subject_id);
    CREATE INDEX IF NOT EXISTS idx_works_user ON works(user_id);
    CREATE INDEX IF NOT EXISTS idx_files_work ON files(work_id);
    CREATE INDEX IF NOT EXISTS idx_files_user ON files(user_id);
    CREATE INDEX IF NOT EXISTS idx_recycle_user ON recycle_bin(user_id);
    CREATE INDEX IF NOT EXISTS idx_recycle_expires ON recycle_bin(expires_at);
  `);
}

export async function initDatabase(): Promise<DatabaseClient> {
  if (currentDb) {
    return currentDb;
  }

  const usePostgres = Boolean(process.env.DATABASE_URL && process.env.DB_DRIVER !== 'sqlite');

  if (usePostgres) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    currentDb = new PostgresDatabaseClient(pool);
    currentDriver = 'postgres';
    await ensurePostgresSchema(currentDb);
    return currentDb;
  }

  const dataDir = path.dirname(SQLITE_DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const db = new Database(SQLITE_DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initializeSchema(db);
  currentDb = new SqliteDatabaseClient(db);
  currentDriver = 'sqlite';
  return currentDb;
}

export function getDatabase(): DatabaseClient {
  if (!currentDb) {
    throw new Error('Database has not been initialized');
  }
  return currentDb;
}

export function getDatabaseDriver(): Driver | undefined {
  return currentDriver;
}

export async function closeDatabase(): Promise<void> {
  if (!currentDb) {
    return;
  }

  await currentDb.close();
  currentDb = undefined;
  currentDriver = undefined;
}
