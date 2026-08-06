# Implement Security, Audit Logging, Abuse Prevention & Transparency for LabRepo

You are working on the backend and frontend of **LabRepo**, a file backup platform for students. Your task is to implement a production-ready security, moderation, and transparency layer. The implementation should be modular, maintainable, performant, and follow industry best practices. Avoid hardcoding values wherever possible.

## **IMPORTANT: Do NOT start coding immediately.**

Before making any code changes:

1. Analyze the existing codebase.
2. Understand the current architecture and data flow.
3. Produce a detailed implementation plan.
4. Wait for my approval before implementing anything.

The implementation plan should include:

- Current architecture overview
- Database/schema changes
- New models/tables
- New services
- Middleware additions
- API endpoints to create or modify
- Frontend pages/components
- Files to be created
- Files to be modified
- Migration strategy
- Security considerations
- Performance implications
- Potential breaking changes
- Testing strategy
- Recommended implementation order

Only after approval should implementation begin.

While implementing:

- Keep changes modular.
- Avoid unnecessary refactoring unrelated to this task.
- Follow the existing project architecture.
- Explain important design decisions.
- Maintain backward compatibility whenever possible.

---

# Goals

Implement:

- Comprehensive audit logging
- User usage tracking
- Daily analytics
- Abuse detection
- Rate limiting
- Admin moderation tools
- Soft deletion
- Secure metadata handling
- Virus scanning abstraction
- Public transparency page
- Configurable security limits
- Extensible architecture

---

# 1. Audit Logging

Create an `AuditLog` model/table.

Fields:

- id
- userId
- action
- resourceType
- resourceId
- ipAddress
- userAgent
- createdAt
- metadata (JSON)

Automatically log all important actions, including:

- User registration
- Login
- Logout
- Password reset
- Repository created
- Repository renamed
- Repository deleted
- Repository restored
- File uploaded
- File downloaded
- File deleted
- Profile updated
- Storage quota exceeded
- Failed uploads
- Failed login attempts
- Admin actions

The metadata field should be flexible.

Example:

```json
{
  "repositoryId": "...",
  "fileName": "...",
  "fileSize": 1839201,
  "mimeType": "application/pdf"
}
```

Implement audit logging as a reusable service or middleware instead of duplicating logic inside controllers.

---

# 2. User Usage Statistics

Maintain aggregated usage statistics for every user.

Track:

- storageUsed
- repositoryCount
- fileCount
- uploadsToday
- downloadsToday
- totalUploads
- totalDownloads
- lastUploadAt
- lastLoginAt

Keep these updated automatically whenever relevant actions occur.

Avoid expensive aggregate database queries whenever possible.

---

# 3. Daily Usage History

Create a table storing one aggregated activity record per user per day.

Fields:

- userId
- date
- uploads
- downloads
- storageUsed
- apiRequests
- loginCount

Design this so future dashboards can easily display usage trends.

---

# 4. Abuse Detection

Implement configurable abuse detection.

Examples include:

### Upload spam

Example:

100 uploads/hour

Flag account.

### Storage abuse

Detect unusually large storage increases within a configurable period.

### Repository spam

Detect excessive repository creation.

### Download abuse

Detect suspicious download bursts.

### Failed login attacks

Temporarily throttle or lock accounts.

### Malware uploads

Flag users repeatedly uploading infected files.

Store abuse thresholds inside configuration/environment variables rather than hardcoding them.

---

# 5. File Validation

Validate uploads before storing.

Validate:

- File extension
- MIME type
- Maximum file size

Do not rely solely on the filename.

---

# 6. File Metadata

Store metadata separately from file contents.

Track:

- Original filename
- Extension
- MIME type
- File size
- Upload timestamp
- Uploader
- Repository
- SHA-256 hash

Never inspect user file contents for moderation purposes.

Moderation should rely primarily on metadata, hashes, and behavioral analysis.

---

# 7. Virus Scanning

Design a virus scanning abstraction.

Current implementation may be a stub.

Future implementations should easily integrate ClamAV or another antivirus engine.

Desired upload flow:

Upload

↓

Temporary storage

↓

Virus scan

↓

Pass → Store permanently

↓

Fail → Reject upload

---

# 8. Rate Limiting

Implement configurable rate limiting.

Example defaults:

- Login: 5/minute
- Upload: 20/minute
- Repository creation: 10/hour
- Password reset: 3/hour

Prefer Redis.

Gracefully fallback to in-memory storage if Redis is unavailable.

---

# 9. Soft Delete

Repositories and files should support soft deletion.

Fields:

- deletedAt
- deletedBy

Deleted resources should be hidden from users but recoverable.

Support:

- Restore repository
- Restore file

Future background cleanup jobs should permanently remove expired deleted resources.

---

# 10. Admin Moderation

Create secure admin-only moderation endpoints.

Include:

- View user summary
- View usage
- View audit logs
- View abuse flags
- Suspend uploads
- Freeze account
- Restore account
- Delete repository
- Restore repository
- Reset quotas

Every admin action must also generate audit logs.

---

# 11. Abuse Flags

Create an AbuseFlag model.

Fields:

- id
- userId
- type
- severity
- reason
- createdAt
- resolved
- resolvedBy
- notes

Example types:

- UPLOAD_SPAM
- STORAGE_ABUSE
- LOGIN_ATTACK
- MALWARE_UPLOAD
- DOWNLOAD_SPAM

---

# 12. Security

Always record:

- IP address
- User-Agent

Never expose this information publicly.

Additionally:

- Hash sensitive tokens
- Never trust client MIME types
- Validate upload size before writing files
- Sanitize filenames
- Prevent path traversal attacks
- Reject dangerous filenames

---

# 13. Configuration

Move all configurable values into environment/configuration files.

Examples:

- MAX_UPLOAD_SIZE
- MAX_STORAGE_PER_USER
- LOGIN_RATE_LIMIT
- UPLOADS_PER_MINUTE
- MAX_REPOSITORIES
- ALLOWED_FILE_TYPES
- ABUSE_THRESHOLDS

Never hardcode operational limits.

---

# 14. Code Quality

Use clean architecture.

Business logic should live in services.

Controllers should remain thin.

Create reusable:

- Logging service
- Moderation service
- Validation service
- Rate limiting middleware
- Security middleware
- Repository layer

Follow SOLID principles.

Write clean TypeScript.

Use interfaces where appropriate.

---

# 15. Future Extensibility

Design the implementation so future features can be added with minimal changes.

Examples:

- Prometheus metrics
- Grafana dashboards
- Email alerts
- Admin notifications
- Cloud storage providers
- Distributed workers
- Queue-based processing
- Background cleanup jobs
- Real-time moderation dashboard

Optimize database queries and index commonly queried columns such as:

- userId
- createdAt
- action

---

# 16. Public Security & Moderation Page

Create a publicly accessible page explaining LabRepo's moderation and security practices in simple, student-friendly language.

The page should explain:

- Why moderation exists
- Why audit logs are necessary
- What activity is logged
- What metadata is collected
- What is **not** collected
- That LabRepo does **not** inspect file contents for moderation
- How abuse detection works at a high level
- Why rate limiting exists
- Why temporary IP logging is necessary
- How user privacy is protected
- That user data is never sold or used for advertising
- How users can contact support or appeal moderation actions

Suggested sections:

- Why We Log Activity
- What Information We Collect
- What We Don't Collect
- Abuse Prevention
- Your Privacy
- Data Retention
- Contact & Appeals

Keep the writing transparent, concise, and easy to understand.

---

# 17. Website Footer

Add a footer link pointing to the public moderation page.

Suggested labels:

- Security & Moderation
- Trust & Safety
- Privacy & Moderation

Choose the label that best matches the existing design language.

The page should be discoverable without cluttering the interface.

---

# 18. General Expectations

Throughout implementation:

- Minimize database queries.
- Use proper indexing.
- Keep the codebase maintainable.
- Follow existing coding conventions.
- Avoid introducing breaking changes.
- Write production-quality code.
- Ensure security is considered in every component.
- Keep the implementation modular and future-proof.
- Where appropriate, add comments explaining non-obvious decisions.
- If any ambiguity is encountered, stop and ask for clarification rather than making assumptions.