# ADR 0002: Integration tests run against real PostgreSQL

- **Status:** Accepted
- **Date:** 2026-11-15

## Context

The riskiest defects in this project do not live in pure functions. They live in the behaviour of the database: unique constraints under concurrent writes, `ON DELETE SET NULL` versus `CASCADE`, interactive transactions that must roll back together, case-insensitive search, and migrations that drift from the Prisma schema. A mocked Prisma client would happily accept a `where` clause that PostgreSQL rejects.

In-memory substitutes such as SQLite are not equivalent either. Collation, `citext`-style case folding, `int8` arithmetic, row locking and partial indexes all differ, and those are exactly the places this code relies on.

At the same time, requiring Docker on every contributor machine narrows who can run the suite. The project must stay testable on a plain Windows laptop without Docker.

## Decision

- **The integration suite talks to a real PostgreSQL server** through the real Express application via Supertest — the whole middleware stack, not a route handler in isolation.
- **Schema setup is always `prisma migrate deploy`**, never `db push`. The suite therefore verifies the committed migrations, not just the schema file.
- **CI provides PostgreSQL 17** as a service container (`postgres:17-alpine`) and runs the same command developers run.
- **Local runs without `DATABASE_URL` start an embedded PostgreSQL binary** on a random port, apply migrations, run, and tear it down. No Docker required.
- **Every test file truncates all application tables** between cases (`resetDatabase()`), including `RESTART IDENTITY CASCADE`, so tests are order-independent and start from a known-empty state.
- **Integration tests are a separate command** (`npm run test:integration`) from the fast unit suite (`npm test`), so the inner loop stays quick.

## Consequences

- The suite is slower than unit tests (minutes rather than seconds), which is why it is split out and runs with `--runInBand` so cases cannot interleave their truncations.
- Failures are meaningful: a broken constraint, a missing index-backed filter or a bad transaction surfaces as a genuine database error.
- Embedded PostgreSQL cleanup is best-effort on Windows, where the postmaster can hold a file handle for a moment; a cleanup warning never masks the test result.
- Developers must keep migrations in sync with `schema.prisma`; the suite will not paper over drift.
- Truncation means tests cannot rely on seed data. Each test builds only what it asserts on, which keeps them readable but duplicates small helpers such as `registerUser` by convention.

## Alternatives considered

- **SQLite or an in-memory emulator** — rejected: semantics differ from the production database in the areas that matter most.
- **Testcontainers** — excellent on Linux/macOS and in CI, but requires a working Docker daemon; kept as an option for contributors who prefer it, not a requirement.
- **Transactional test rollback instead of truncation** — faster, but cannot cover code that itself opens transactions and would hide commit-time constraint failures.
- **Mocking Prisma** — rejected: a mock cannot validate SQL, constraints or locking, which is the point of this layer.
