## Plan: PostgreSQL Migration via Drizzle

Migrate the server from embedded SQLite with `better-sqlite3` to PostgreSQL managed through Drizzle, while preserving a development fallback path and migrating existing SQLite data into PostgreSQL. The goal is to remove the single-writer bottleneck from write-heavy operations, keep the current API behavior stable, and make the persistence layer easier to evolve.

**Steps**
1. Inventory the current data model and write paths, then define the target database boundary. The current server uses a single SQLite file initialized in `server/src/db/index.ts`, schema bootstrapping in `server/src/db/schema.ts`, and direct `db.prepare(...)` calls across all CRUD routes plus cleanup jobs. This step confirms which tables, constraints, and transaction patterns must be preserved in the new schema and which app paths need query rewrites.
2. Introduce Drizzle as the database abstraction layer, with a Postgres primary driver and a dev fallback. Replace the direct `better-sqlite3` connection in `server/src/db/index.ts` with a small adapter that can create either a PostgreSQL Drizzle client or a local SQLite fallback based on environment configuration. Keep the rest of the app consuming a single shared DB access module so route code does not need to know the deployment mode.
3. Recreate the schema in Drizzle format and map SQLite semantics to PostgreSQL equivalents. Move the table definitions from `server/src/db/schema.ts` into Drizzle schema files, preserving primary keys, uniqueness rules, foreign keys, timestamps, and recycle-bin retention fields. Review SQLite-specific behavior like `AUTOINCREMENT`, `datetime('now')`, integer booleans, and `CHECK` constraints so the Postgres schema matches the current data contracts.
4. Rewrite all route and job queries to Drizzle query APIs. Update the CRUD and search handlers in `server/src/routes/*.ts` and `server/src/jobs/cleanup.ts` to use Drizzle selects, inserts, updates, deletes, joins, and transactions instead of raw SQL strings against `better-sqlite3`. Pay special attention to ownership checks, duplicate-name validation, recycle-bin moves, file upload metadata writes, and the aggregate queries in session/search endpoints.
5. Add a one-time SQLite to PostgreSQL migration path for existing data. Create an import script that reads the current SQLite database, transforms the rows into the new schema shape, and inserts them into PostgreSQL in dependency order. Preserve IDs if feasible, or record an explicit ID mapping if foreign-key restoration requires it, and include validation that row counts and key relationships match after import.
6. Update configuration, deployment, and documentation to reflect the new database path. Add the required Postgres connection env vars, Drizzle migration or generation workflow, and startup checks to `server/package.json`, `README.md`, and any production setup docs. Keep the fallback behavior documented so local developers know when they are using SQLite versus PostgreSQL.
7. Verify behavior and concurrency-sensitive flows end to end. Run the server build, then exercise the main write paths that previously depended on SQLite serialization: session creation and updates, file uploads, recycle-bin moves, cleanup deletions, and search filters. If available, run the app against a real Postgres instance to confirm the new driver path works under concurrent writes.

**Relevant files**
- `server/src/db/index.ts` — replace the SQLite singleton with the new Drizzle-backed database bootstrap.
- `server/src/db/schema.ts` — convert schema definitions into Drizzle table declarations or split them into dedicated schema modules.
- `server/src/routes/sessions.ts` — migrate session CRUD, duplicate checks, and recycle-bin transaction logic.
- `server/src/routes/subjects.ts` — migrate subject CRUD and ownership checks.
- `server/src/routes/works.ts` — migrate work CRUD and related lookups.
- `server/src/routes/files.ts` — migrate file metadata writes, listing, and soft-delete flows.
- `server/src/routes/download.ts` — migrate file lookup queries used for downloads.
- `server/src/routes/recycle-bin.ts` — migrate recycle-bin listing, restore, and purge queries.
- `server/src/routes/search.ts` — migrate the aggregate search queries and filter lists.
- `server/src/routes/user.ts` — migrate user bootstrap and onboarding lookup/write logic.
- `server/src/jobs/cleanup.ts` — migrate cleanup queries and transactional deletes.
- `server/src/index.ts` — update startup and shutdown wiring for the new DB lifecycle.
- `server/package.json` — add Drizzle and PostgreSQL dependencies plus migration scripts.
- `server/package-lock.json` — capture the dependency changes after installation.
- `README.md` and `PRODUCTION_SETUP.md` — document env vars, migration steps, and operational changes.

**Verification**
1. Build the server with `npm run build` from `server/` after the schema and query rewrites.
2. Run a focused startup check against PostgreSQL and confirm the API boots cleanly, initializes schema, and reaches the health endpoint.
3. Execute the critical write flows manually or with targeted tests: create/update/delete sessions, upload/delete files, restore from recycle bin, and trigger cleanup paths.
4. Run the SQLite-to-Postgres import against a copy of the current database and compare row counts plus a few relational joins before and after import.
5. If a local Postgres instance is available, run a small concurrent write smoke test to confirm the contention behavior improves relative to SQLite.

**Decisions captured**
- PostgreSQL target: Neon.
- Existing SQLite data must be migrated.
- SQLite fallback stays available for development, but PostgreSQL is the primary path.

**Further Considerations**
1. Confirm whether the fallback should be a true dual-driver mode or only a temporary dev-only compatibility path.
2. Decide whether the migration should preserve existing integer IDs exactly or allow regenerated IDs with reference remapping.
3. Choose the preferred local Postgres workflow for developers, such as an external service, Docker, or a managed free tier.
