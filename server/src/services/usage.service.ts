import { getDatabase } from '../db/runtime.js';

interface UsageUpdateOptions {
  userId: string;
  storageDelta?: number;
  fileDelta?: number;
  repositoryDelta?: number;
  uploadDelta?: number;
  downloadDelta?: number;
  loginDelta?: number;
  timestamp?: string;
}

export async function updateUserUsage(options: UsageUpdateOptions): Promise<void> {
  const db = getDatabase();
  const timestamp = options.timestamp ?? new Date().toISOString();
  const today = timestamp.split('T')[0];

  await db.run(`
    INSERT INTO user_usage_stats (
      user_id,
      storage_used,
      repository_count,
      file_count,
      uploads_today,
      downloads_today,
      total_uploads,
      total_downloads,
      last_upload_at,
      last_login_at
    ) VALUES (?, 0, 0, 0, 0, 0, 0, 0, NULL, NULL)
    ON CONFLICT(user_id) DO NOTHING
  `, [options.userId]);

  await db.run(`
    UPDATE user_usage_stats
    SET storage_used = storage_used + COALESCE(?, 0),
        repository_count = repository_count + COALESCE(?, 0),
        file_count = file_count + COALESCE(?, 0),
        uploads_today = uploads_today + COALESCE(?, 0),
        downloads_today = downloads_today + COALESCE(?, 0),
        total_uploads = total_uploads + COALESCE(?, 0),
        total_downloads = total_downloads + COALESCE(?, 0),
        last_upload_at = COALESCE(?, last_upload_at),
        last_login_at = COALESCE(?, last_login_at)
    WHERE user_id = ?
  `, [
    options.storageDelta ?? 0,
    options.repositoryDelta ?? 0,
    options.fileDelta ?? 0,
    options.uploadDelta ?? 0,
    options.downloadDelta ?? 0,
    options.uploadDelta ?? 0,
    options.downloadDelta ?? 0,
    options.uploadDelta !== undefined ? timestamp : null,
    options.loginDelta !== undefined ? timestamp : null,
    options.userId,
  ]);

  await db.run(`
    INSERT INTO daily_usage_history (user_id, date, uploads, downloads, storage_used, api_requests, login_count)
    VALUES (?, ?, 0, 0, 0, 0, 0)
    ON CONFLICT(user_id, date) DO NOTHING
  `, [options.userId, today]);

  await db.run(`
    UPDATE daily_usage_history
    SET uploads = uploads + COALESCE(?, 0),
        downloads = downloads + COALESCE(?, 0),
        storage_used = storage_used + COALESCE(?, 0),
        api_requests = api_requests + 1,
        login_count = login_count + COALESCE(?, 0)
    WHERE user_id = ? AND date = ?
  `, [
    options.uploadDelta ?? 0,
    options.downloadDelta ?? 0,
    options.storageDelta ?? 0,
    options.loginDelta ?? 0,
    options.userId,
    today,
  ]);
}
