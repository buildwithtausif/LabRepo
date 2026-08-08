# Full Codebase ORM Error Audit & Feature Functionality Audit

You are auditing **my own application/codebase**. This is an authorized defensive software-engineering task. Do **not** interpret this request as an attempt to exploit, attack, or gain unauthorized access to any system.

The application uses **Drizzle ORM** for database access.

## Primary Issue to Investigate

There is currently a SQL/ORM-related error causing a session-loading failure. One observed symptom is:

> `Failed to load session`

This occurs when accessing:

> `/dashboard`

I have provided the error trace from one such real incident here:

`D:\error_trace_labrepo_7820262335.txt`

### First task

Read and analyze this error-trace file carefully.

Trace the error from:

**HTTP request → route/controller → authentication/session logic → service layer → Drizzle ORM query → SQL/database interaction → error handling**

Determine:

1. The exact root cause of the error.
2. The exact Drizzle ORM query that is failing.
3. The SQL/query structure generated or implied by that Drizzle query.
4. Whether the problem is caused by:
   - incorrect table/schema definition
   - incorrect column reference
   - incorrect relation
   - incorrect Drizzle query construction
   - incorrect joins
   - incorrect query conditions
   - missing/incorrect migration
   - database schema drift
   - incorrect data type
   - null/undefined handling
   - authentication/session logic
   - connection/configuration problems
   - transaction handling
   - another application-level issue
5. Why this manifests specifically as `Failed to load session` on `/dashboard`.
6. Whether the error could occur in other parts of the application as well.

Do not merely patch the first error. **Trace the underlying cause and look for the same class of mistake elsewhere in the codebase.**

---

# ORM / SQL Error Audit

Perform a systematic audit of the entire codebase for **Drizzle ORM and database-query-related errors** similar to the observed session failure.

Inspect:

- Drizzle schema definitions
- relations
- migrations
- database initialization/configuration
- repositories
- services
- API routes
- server-side functions
- authentication/session code
- transactions
- CRUD operations
- joins
- filters
- ordering
- pagination
- inserts
- updates
- deletes
- selects
- raw SQL, if present
- type definitions related to database entities
- error handling around database operations

Look specifically for patterns that could produce runtime SQL errors even if TypeScript compilation succeeds.

Examples include:

- querying columns that do not exist
- schema/query mismatch
- incorrect table names
- incorrect aliases
- invalid joins
- incorrect relation definitions
- incorrect foreign-key assumptions
- selecting fields that don't exist
- incorrect Drizzle operators
- invalid conditions
- incorrect handling of nullable fields
- incorrect parameter types
- migration/schema mismatch
- queries written against an outdated schema
- incorrect transaction usage
- queries that can fail because required records do not exist
- errors being swallowed and replaced with misleading generic errors
- session/auth queries that can fail under specific states
- duplicated or inconsistent database-access patterns

For every suspicious finding, verify it against the actual code before reporting it. **Do not report speculative issues as confirmed bugs.**

---

# Audit Similar Runtime Failures

Search the codebase for other places where a database/ORM failure could surface as a generic application error.

For example:

```text
Failed to load session
Failed to fetch ...
Failed to load ...
Internal server error
Database error
Query failed
Unable to fetch ...
Unable to create ...
Unable to update ...
Unable to delete ...
```

Trace these errors back to their underlying database operations.

Identify cases where:

**database error → generic error message**

causes the actual root cause to become difficult to diagnose.

Recommend improvements to error handling/logging where appropriate, while avoiding leaking sensitive database information to end users.

---

# Full Application Feature Audit

In addition to the ORM audit, perform a **functional audit of the entire codebase**.

Identify every major user-facing feature/module and verify that it is actually wired correctly through the full stack.

For each feature, inspect the complete flow:

**UI → frontend logic → API/request → backend route → service/business logic → database/ORM → response → UI state**

Check for:

- broken imports
- dead code
- missing routes
- incorrect API endpoints
- incorrect request/response structures
- frontend/backend contract mismatches
- incorrect TypeScript types
- missing validation
- missing error handling
- database query errors
- authentication/authorization problems
- session handling problems
- loading-state issues
- empty-state issues
- error-state issues
- incorrect redirects
- stale assumptions about database schema
- features that appear implemented in the UI but have incomplete backend logic
- backend functionality that has no corresponding frontend handling
- buttons/forms/actions that do not actually perform the intended operation
- CRUD operations that are incomplete or inconsistent
- edge cases that can break normal functionality

Do not modify functionality simply because you personally prefer a different implementation. The goal is to determine whether the **existing intended functionality works correctly**.

---

# Important Audit Rules

### 1. Do not make speculative claims

Only classify something as a confirmed bug when there is sufficient evidence in the code, schema, migration, trace, or execution flow.

Use these classifications:

- **Confirmed Bug**
- **Likely Bug**
- **Potential Risk**
- **Working Correctly**
- **Needs Runtime Verification**

### 2. Do not blindly rewrite the application

This is an **audit first**, not a rewrite.

Do not make large architectural changes merely to make the code look cleaner.

### 3. Preserve existing architecture

The application already uses Drizzle ORM. Do not replace Drizzle with another ORM or database abstraction.

### 4. Follow the actual code

Do not infer functionality from filenames or UI labels alone. Trace the actual implementation.

### 5. Check schema + migrations + queries together

A Drizzle query can appear correct while the actual database schema is outdated.

Therefore compare:

**Drizzle schema ↔ migrations ↔ actual query usage ↔ expected database structure**

where the available code/configuration permits this verification.

### 6. Treat the supplied error trace as an important starting point

The `/dashboard` session failure is one known incident.

Use it to identify the underlying failure pattern, then search the rest of the application for **similar mistakes**, rather than assuming this is the only problem.

---

# Deliverables

Create a detailed audit report containing:

## 1. Executive Summary

Briefly explain:

- what is causing the known `/dashboard` session failure
- how serious it is
- whether similar issues were found elsewhere
- overall health of the application

## 2. Root Cause Analysis

For the known error:

```text
Failed to load session
```

Provide the complete execution path and exact root cause.

Include relevant file paths, functions, and code locations.

## 3. ORM/SQL Audit

Create a table:

| Location | Query/Operation | Finding | Classification | Evidence | Recommended Fix |
|---|---|---|---|---|---|

Include all confirmed and relevant potential ORM/database issues.

## 4. Feature Audit

Create a table:

| Feature | Frontend | API | Backend | Database | Error Handling | Status | Findings |
|---|---|---|---|---|---|---|---|

Mark each feature as:

- ✅ Working
- ⚠️ Needs Verification
- 🟠 Partial/Broken
- 🔴 Confirmed Broken

## 5. Error-Handling Audit

Identify places where real database/application errors are being hidden behind generic messages.

Explain how debugging could be improved without exposing sensitive information to users.

## 6. Priority List

Rank findings:

### P0 — Critical
Prevents core functionality or causes serious data/security problems.

### P1 — High
Breaks important functionality or is likely to cause recurring runtime failures.

### P2 — Medium
Important correctness/reliability issue but has a workaround.

### P3 — Low
Minor issue, maintainability concern, or improvement.

## 7. Recommended Fix Plan

Provide a practical implementation order.

For each fix explain:

- what should change
- why
- affected files
- dependencies on other fixes
- potential regression risks

---

# Very Important: Audit Before Modifying

**Do not immediately start changing code.**

First inspect the codebase and the supplied error trace, perform the audit, and produce the findings.

If you identify fixes that should be implemented, clearly separate:

**AUDIT FINDINGS**

from

**PROPOSED FIXES**

Do not silently modify unrelated parts of the application.

The goal is to understand the actual state of the codebase first, identify the root cause of the existing Drizzle/SQL session error, discover similar errors, and verify that the application's features are functionally wired correctly end-to-end.