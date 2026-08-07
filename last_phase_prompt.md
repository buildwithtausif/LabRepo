# LabRepo Production Infrastructure & Architecture Migration

You are acting as a Principal Software Engineer, DevOps Engineer, Backend Engineer, Infrastructure Engineer, and Security Engineer.

Your objective is to evolve the existing LabRepo project into a production-ready, maintainable system while **preserving existing functionality**.

Your highest priorities are:

- Stability
- Maintainability
- Simplicity
- Security
- Incremental implementation

Do **NOT** optimize for introducing new technology. Optimize for long-term maintainability.

---

# Working Rules

Follow these rules throughout the project.

- Do NOT begin implementation immediately.
- Do NOT assume anything.
- Inspect the repository first.
- Read existing code before changing it.
- Never rewrite working code only for style.
- Preserve existing APIs and behaviour whenever possible.
- Avoid over-engineering.
- Every phase must leave the project fully working.
- Prefer simple engineering over clever engineering.
- If you discover a better approach than originally planned, explain it briefly before proceeding.

---

# Communication Rules

Keep engineering updates concise.

Do **NOT** produce long reasoning or chain-of-thought style explanations.

For every phase only provide:

- What you inspected
- What you discovered
- Files that will change
- Risks (if any)
- Recommendation (1–2 sentences)

Then stop and wait for approval.

Spend implementation tokens on engineering rather than explanations.

---

# Phase 0 — Repository Audit (NO CODE CHANGES)

Before changing any file:

Inspect the complete repository.

Identify:

- Overall architecture
- Frontend stack
- Backend stack
- Folder structure
- Existing Docker setup
- Existing deployment flow
- Existing upload flow
- Authentication flow
- Existing storage implementation
- Database layer
- ORM
- Migration system
- Environment handling
- Build pipeline
- Logging
- Health endpoints
- Security measures
- Existing documentation
- Technical debt
- Production blockers

Also inspect every deployment-related document.

## IMPORTANT

Read **PRODUCTION\_SETUP** completely.

Treat it as the source of truth for storage architecture and production deployment.

After inspection provide only:

1. Findings
2. Risks
3. Missing production pieces
4. Recommended architecture
5. Phased implementation roadmap

Then stop.

Wait for approval.

---

# SEO Architecture (Repository Inspection Required)

During repository inspection, evaluate the current SEO implementation.

I want a centralized SEO architecture instead of page-specific SEO definitions scattered throughout the project.

Use the following reference as architectural inspiration:

[https://raw.githubusercontent.com/buildwithtausif/my-website/refs/heads/dev/src/utils/seoConfig.ts](https://raw.githubusercontent.com/buildwithtausif/my-website/refs/heads/dev/src/utils/seoConfig.ts)

Study the structure and implement a **similar concept**, adapted to this project rather than copied directly.

## Goals

Create a dedicated SEO utility that becomes the **single source of truth** for SEO throughout the application.

Every page should derive its SEO configuration from this centralized module instead of maintaining independent metadata.

The architecture should be easy to maintain and extend.

## Requirements

Design a centralized SEO utility that manages:

- page titles
- meta descriptions
- Open Graph metadata
- Twitter metadata
- canonical URLs
- robots configuration
- structured metadata where applicable
- default SEO values
- page-specific overrides
- dynamic metadata where necessary

Avoid duplicated metadata.

Avoid page-level hardcoding whenever possible.

## Admin Integration

Provide an administration interface for SEO management.

The administrator should be able to update SEO-related values without modifying source code where appropriate.

Examples include:

- default site title
- default description
- homepage SEO
- social preview images
- canonical domain
- robots behaviour
- verification tags
- organization information
- default Open Graph values

Changes should propagate automatically throughout the application.

## Source of Truth

The centralized SEO configuration should remain the primary source of truth.

The admin panel should read from and write to this configuration through the application's architecture rather than introducing duplicate configuration systems.

Code should remain understandable for developers.

The goal is:

One SEO architecture.

One source of truth.

Minimal duplication.

Maximum maintainability.

After inspecting the existing project, recommend the best implementation approach before making changes.

---

# Overall Architecture

After repository inspection, design the production architecture.

Expected direction:

Internet

↓

Nginx

↓

Frontend\
Backend

↓

PostgreSQL\
MinIO

Validate this architecture instead of assuming it.

Recommend improvements if appropriate.

---

# Phased Implementation

Do NOT implement everything together.

Implement incrementally.

Each phase must end with a working project.

Example progression:

Phase 1

Infrastructure preparation

- Docker cleanup
- Environment cleanup
- Docker networking
- Project organization

STOP.

Wait for approval.

---

Phase 2

Backend containerization.

STOP.

---

Phase 3

Frontend containerization.

STOP.

---

Phase 4

PostgreSQL integration.

- Container
- Persistent volumes
- Automatic migrations
- Startup ordering
- Health checks

STOP.

---

Phase 5

MinIO integration.

Read PRODUCTION\_SETUP before implementation.

Integrate MinIO into the existing upload architecture without breaking current functionality.

STOP.

---

Phase 6

Nginx integration.

Configure production reverse proxy.

STOP.

---

Phase 7

Security hardening.

STOP.

---

Phase 8

SEO architecture implementation.

Centralize SEO.

Integrate admin controls.

STOP.

---

Phase 9

Documentation.

STOP.

---

# PostgreSQL

Inspect the repository.

Determine:

- ORM
- migration tool
- startup flow
- connection handling

Configure automatic migrations.

Backend must never start if migrations fail.

---

# MinIO

Read PRODUCTION\_SETUP before implementation.

Determine how storage currently works.

Integrate MinIO appropriately.

Do not replace working storage logic unnecessarily.

Implement:

- persistent volumes
- bucket initialization
- health checks
- environment configuration
- production deployment

---

# MinIO Administration

Provide administrative capabilities.

Administrator should be able to:

- manage buckets
- monitor usage
- monitor storage health
- view storage statistics
- monitor virus scan results
- monitor malicious upload attempts
- perform backups
- monitor capacity

## Privacy Requirements

Privacy is non-negotiable.

Infrastructure administrators should operate storage, not inspect user data.

Expose only operational metadata.

Examples:

Allowed:

- storage usage
- upload size
- timestamps
- integrity status
- scan status
- malware detection
- bucket health
- storage capacity

Avoid exposing whenever practical:

- user documents
- previews
- images
- repository contents
- filenames where avoidable
- user-owned content

Recommend and implement encryption and architectural safeguards so uploaded content remains private while infrastructure remains manageable.

The design principle is:

Users own their data.

Administrators operate infrastructure.

Administrators should not become data readers.

provide interface in admin console for it.

---

# Nginx

Inspect existing routing.

Integrate nginx appropriately.

Potential responsibilities:

- reverse proxy
- frontend serving
- websocket proxying
- upload proxying
- gzip
- caching
- HTTPS readiness
- security headers
- rate limiting where appropriate

Implement only what the project requires.

---

# Docker

Determine required Docker artifacts.

Likely outputs:

- backend Dockerfile
- frontend Dockerfile
- docker-compose.yml
- docker-compose.production.yml
- .dockerignore
- health checks
- restart policies
- Docker networks
- persistent volumes

Prefer multi-stage builds.

Minimize image sizes.

also write dockerfile.vercel for similar deployment

---

# Environment Management

Organize environment variables.

Avoid duplication.

Never hardcode secrets.

Update environment examples where necessary.

---

# Security

Improve security without breaking functionality.

Evaluate practical protections including:

- internal Docker networking
- least-privilege containers
- non-root execution
- secrets via environment variables
- upload validation
- secure defaults
- resource limits
- health checks
- production-safe configuration

Avoid security theatre.

Implement practical protections only.

---

# Documentation

Update documentation only after implementation.

Document:

- architecture
- deployment
- startup
- backup
- restore
- migrations
- troubleshooting
- production notes
- provide maintenance and new feature addition notes for developer

---

# Engineering Principles

Throughout implementation:

- Preserve backend behaviour.
- Preserve frontend behaviour.
- Preserve APIs.
- Preserve upload flow.
- Refactor only when it directly improves maintainability or production readiness.
- Prefer maintainable solutions over clever ones.
- Keep the architecture understandable.
- Avoid unnecessary abstractions or additional services.
- Optimize for a single EC2 production deployment unless the repository clearly requires otherwise.

---

# Final Objective

Deliver a production-ready LabRepo architecture with:

- Nginx as the entry point
- Dockerized frontend
- Dockerized backend
- PostgreSQL with automatic migrations
- MinIO integrated according to PRODUCTION\_SETUP
- Persistent storage
- Secure Docker networking
- Centralized SEO architecture with a single source of truth and admin controls
- Operational observability
- Strong user-data privacy
- Incremental, reviewable implementation that minimizes disruption to the existing application.
