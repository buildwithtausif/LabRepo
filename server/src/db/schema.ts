import Database from 'better-sqlite3';

export function initializeSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      clerk_id TEXT NOT NULL UNIQUE,
      onboarding_completed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS academic_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      auto_delete INTEGER NOT NULL DEFAULT 0,
      auto_delete_date TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, name)
    );

    CREATE TABLE IF NOT EXISTS subjects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES academic_sessions(id) ON DELETE CASCADE,
      UNIQUE(session_id, name)
    );

    CREATE TABLE IF NOT EXISTS works (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      work_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      sanitized_filename TEXT NOT NULL,
      extension TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      storage_key TEXT NOT NULL,
      content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS recycle_bin (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      item_type TEXT NOT NULL CHECK(item_type IN ('session', 'subject', 'work', 'file')),
      item_id INTEGER NOT NULL,
      original_data TEXT NOT NULL,
      deleted_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );

    -- Indexes for performance
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
