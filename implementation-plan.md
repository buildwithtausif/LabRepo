# Implementation Plan: Security, Audit Logging, Abuse Prevention & Transparency

## 1. Current architecture overview

- Frontend: Astro app with shared layout in src/Layouts/Layout.astro and pages in src/pages.
- Backend: Fastify API in server/src/index.ts with Clerk-based authentication in server/src/auth/clerk.ts.
- Data layer: shared DB abstraction in server/src/db/runtime.ts that initializes SQLite or Postgres schemas on startup.
- File handling: uploads, validation, and storage flow are currently concentrated in server/src/routes/files.ts.
- Existing soft-delete behavior is partially implemented through recycle-bin records, but it is not yet a full moderation-aware lifecycle for repositories and files.

## 2. Database and schema changes

Add new tables to the shared schema layer:

- audit_logs
  - id
  - userId
  - action
  - resourceType
  - resourceId
  - ipAddress
  - userAgent
  - createdAt
  - metadata

- user_usage_stats
  - userId
  - storageUsed
  - repositoryCount
  - fileCount
  - uploadsToday
  - downloadsToday
  - totalUploads
  - totalDownloads
  - lastUploadAt
  - lastLoginAt

- daily_usage_history
  - userId
  - date
  - uploads
  - downloads
  - storageUsed
  - apiRequests
  - loginCount

- abuse_flags
  - id
  - userId
  - type
  - severity
  - reason
  - createdAt
  - resolved
  - resolvedBy
  - notes

Add indexes for commonly queried columns such as userId, createdAt, action, resourceType, and resolved.

## 3. New services

Create a modular service layer so controllers remain thin:

- Audit service
  - Centralizes audit logging for auth, uploads, downloads, deletions, restores, admin actions, and failures.

- Validation service
  - Enforces allowed extensions, MIME handling, file size, filename sanitization, and dangerous-name rejection.

- Moderation service
  - Evaluates upload/download/repository patterns, creates abuse flags, and handles suspend/freeze/restore actions.

- Rate limiting service
  - Supports login, upload, repository creation, and password reset limits.
  - Prefer Redis, but gracefully fall back to in-memory storage when unavailable.

- Virus scan abstraction
  - Provides a pluggable interface for future ClamAV or other scanning providers.

- Repository layer
  - Encapsulates database access for moderation-related entities and reduces query duplication.

## 4. Middleware and request handling

Add Fastify middleware/hook support for:

- Request metadata capture (IP address and user agent)
- Rate limiting per action type
- Security validation before file persistence
- Audit hook integration for important actions

## 5. API endpoints to create or modify

### Existing routes to extend
- Upload route: log uploads, validate files, update usage stats, and flag suspicious behavior.
- Download route: record download activity and update usage counters.
- Delete/restore routes: support soft-delete semantics and audit the action.

### New admin-only routes
- GET /api/admin/users/:id/summary
- GET /api/admin/users/:id/usage
- GET /api/admin/audit-logs
- GET /api/admin/abuse-flags
- POST /api/admin/users/:id/suspend-uploads
- POST /api/admin/users/:id/freeze
- POST /api/admin/users/:id/restore
- POST /api/admin/repositories/:id/delete
- POST /api/admin/repositories/:id/restore
- POST /api/admin/users/:id/reset-quota

### Lightweight admin page
- Create a simple admin page at /admin for trusted moderators.
- Keep it minimal: summary cards, recent audit events, and a basic list of abuse flags.
- The page should call the protected admin APIs and require an admin role check on the server.
- This page is intentionally lightweight and focused on moderation visibility rather than a full dashboard.

### Public route
- GET /security-and-moderation
  - Public transparency page explaining moderation, logging, privacy, and data retention.

## 6. Frontend changes

- Create a new public Astro page for security and moderation information.
- Add a lightweight admin Astro page at /admin for trusted moderators.
- Add a footer link in src/Layouts/Layout.astro to make the public moderation page discoverable without clutter.
- Keep the wording transparent, concise, and student-friendly.

## 7. Files to create

- server/src/services/audit.service.ts
- server/src/services/validation.service.ts
- server/src/services/moderation.service.ts
- server/src/services/rate-limit.service.ts
- server/src/services/virus-scan.service.ts
- server/src/routes/admin.ts
- src/pages/admin.astro
- src/pages/security-and-moderation.astro

## 8. Files to modify

- server/src/db/runtime.ts
- server/src/index.ts
- server/src/routes/files.ts
- server/src/routes/user.ts
- server/src/routes/works.ts
- server/src/routes/download.ts
- server/src/routes/recycle-bin.ts
- src/Layouts/Layout.astro

## 9. Migration strategy

- Roll out changes additively first and keep current behavior intact where possible.
- Add the new tables without breaking existing upload/delete flows.
- Introduce soft-delete support gradually, while preserving recycle-bin recovery compatibility.
- Backfill usage stats lazily when a user performs a relevant action instead of running expensive full-table recalculation.

## 10. Security considerations

- Never trust client-supplied MIME types.
- Continue sanitizing filenames and preventing path traversal.
- Record IP address and user agent server-side only.
- Do not expose private security details publicly.
- Hash sensitive tokens and avoid logging secrets.
- Keep moderation based on metadata, behavior, and hashes rather than inspecting user file contents.

## 11. Performance implications

- Add indexes on userId, createdAt, action, resourceType, and resolved columns.
- Update usage counters incrementally rather than recomputing aggregates per request.
- Avoid expensive joins during the hot path for uploads and downloads.
- Keep logging lightweight and use efficient single-statement writes where practical.

## 12. Potential breaking changes

- Delete operations may shift from immediate hard deletion to soft deletion plus recovery steps.
- Admin endpoints should be clearly gated so regular users are unaffected.
- Any new config values should default safely and be documented in environment settings.

## 13. Testing strategy

- Unit tests for validation, rate limiting, and abuse detection logic.
- Integration tests for upload/download audit logging and admin moderation actions.
- Regression tests for restore and recovery flows.

## 14. Recommended implementation order

1. Add schemas and service foundation.
2. Implement audit logging and request metadata capture.
3. Harden upload validation and file handling.
4. Introduce usage stats and daily history updates.
5. Add rate limiting and abuse detection.
6. Add admin moderation endpoints and the lightweight admin page.
7. Add the public moderation/transparency page and footer link.
