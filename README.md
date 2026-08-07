# LabRepo

LabRepo is a modern student workspace designed for safely organizing and retrieving college lab work. It's built with Fastify, Astro, Drizzle ORM, and MinIO.

## Architecture Overview

LabRepo is a full-stack monolithic application split into two main components:
1. **Frontend**: Astro SSR application running on Node.js. Handles routing, UI rendering, and Clerk authentication.
2. **Backend**: Fastify API Server running on Node.js. Handles business logic, database queries, and storage operations.
3. **Database**: PostgreSQL (managed via Drizzle ORM).
4. **Storage**: S3-compatible object storage (MinIO for on-premise, AWS S3 for cloud).
5. **Reverse Proxy**: Nginx handles routing `/api/*` to the backend and all other traffic to the Astro frontend.

## Environment Variables Reference

See `.env.example` for a complete list of required environment variables. Key variables include:

### Authentication
* `PUBLIC_CLERK_PUBLISHABLE_KEY`: Clerk frontend key
* `CLERK_SECRET_KEY`: Clerk backend secret

### Database & Storage
* `DATABASE_URL`: PostgreSQL connection string (e.g. `postgresql://user:pass@host:5432/db`)
* `STORAGE_DRIVER`: `minio` or `s3` (defaults to `mock` in dev)
* `AWS_ACCESS_KEY`, `AWS_SECRET_KEY`, `AWS_BUCKET`, `AWS_REGION`, `AWS_ENDPOINT`: S3 credentials and config

### Application
* `API_PORT`, `API_HOST`: Backend configuration
* `PORT`, `HOST`: Frontend configuration
* `ADMIN_USER_ID`, `CLERK_ADMIN_USER_ID`: IDs of users granted admin access

## Local Development vs. Docker Workflow

### Local Development
1. Start the database and storage via Docker: `docker-compose up minio postgres -d`
2. Run the API server: `cd server && npm run dev`
3. Run the frontend: `npm run dev`

*Note: In local development without Nginx, the frontend makes API calls directly to `http://localhost:3001`.*

### Docker Compose (Production)
The entire stack can be brought up using Docker Compose, which includes Nginx for routing and static asset caching.
```bash
docker-compose up -d --build
```

## Database Schema Notes

The database schema is defined in `server/src/db/schema.ts` and managed via Drizzle Kit.
* Migrations are generated via `npm run db:generate` in the `server` directory.
* Migrations are applied automatically on backend startup via the `runtime.ts` init function.
* Soft deletion is implemented using the `recycle_bin` table for all resources (sessions, subjects, works, files) with a 7-day expiration.

## Deployment Guide (VPS / Coolify)

LabRepo is designed to be easily deployed on a single VPS or PaaS like Coolify.

1. **Clone the repository** to your server.
2. **Copy `.env.example` to `.env`** and configure your secrets (Database, Clerk, MinIO).
3. **Start the stack**:
   ```bash
   docker-compose up -d --build
   ```
4. **Configure HTTPS**: If not using a PaaS that provides SSL termination (like Coolify), configure Nginx with SSL certificates in the `nginx/certs` volume and uncomment the 443 sections in `nginx.conf`.

## Backup and Restore Procedures

### Database (PostgreSQL)
**Backup**:
```bash
docker exec -t labrepo-postgres pg_dump -U labrepo labrepo > backup.sql
```
**Restore**:
```bash
cat backup.sql | docker exec -i labrepo-postgres psql -U labrepo labrepo
```

### Storage (MinIO)
**Backup**:
Use the MinIO client (`mc`) to mirror the bucket to a local directory or another S3 bucket:
```bash
mc mirror myminio/labrepo-storage ./local-backup
```
**Restore**:
```bash
mc mirror ./local-backup myminio/labrepo-storage
```
