# Contributing to GoFlow

Thanks for taking the time to improve GoFlow. This document covers how the project is developed, what a reviewable change looks like, and the conventions the code relies on.

## Getting set up

The [README](README.md#quick-start) has the full setup. In short:

```bash
npm ci
cp .env.example .env
docker compose up -d postgres
npm run db:deploy
npm run db:seed        # optional demo workspace
npm run dev:api        # and, in another terminal, npm run dev:web
```

Node 22+ and PostgreSQL 15+ are required. Docker is optional.

## Before you push

Every pull request must pass the same checks CI runs:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:integration
```

Run `npm run format` to fix formatting instead of arguing with Prettier. Integration tests need a real PostgreSQL server; if `DATABASE_URL` is unset the harness starts an embedded instance by itself.

## Branches

One branch per logical change, named from `main`:

| Prefix      | Use for                             |
| ----------- | ----------------------------------- |
| `feat/`     | New user-visible capability         |
| `fix/`      | Bug fix                             |
| `docs/`     | Documentation only                  |
| `test/`     | Test-only change                    |
| `chore/`    | Tooling, dependencies, housekeeping |
| `refactor/` | Behaviour-preserving restructuring  |

Keep names short and descriptive: `feat/partial-payments`, `fix/date-roundtrip`.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/). The subject carries the changelog; the body explains _why_ the change is correct.

```
feat(invoices): generate drafts from uninvoiced billable time

Why this shape, what trade-offs were made, and what is deliberately not
included yet.
```

Scopes in use: `api`, `web`, `db`, `auth`, `workspaces`, `clients`, `projects`, `time`, `invoices`, `payments`, `expenses`, `reports`, `docs`, `ci`.

Write the body as prose in the imperative mood. Avoid "just", "simply" and unexplained abbreviations.

## Pull requests

A good PR is small enough to review in one sitting and contains one logical change. If you find yourself writing "also", open a second PR.

The description should cover:

1. **Problem** — the behaviour or gap being addressed.
2. **What changed** — the shape of the solution, not a file list.
3. **Decisions** — trade-offs a reviewer might otherwise question.
4. **Verification** — the commands run and the tests added.
5. **Migration or risk notes** — anything that could affect existing data.

For UI changes include a screenshot or short recording.

## Tests

- Bug fixes come with a test that fails before the fix.
- New endpoints need integration coverage for success, validation, permissions and cross-workspace isolation.
- Pure logic (money, dates, parsing) belongs in unit tests under `src/domain/` or beside the module.
- Integration tests use a real PostgreSQL database and must not depend on execution order. Truncation between cases is handled by `resetDatabase()`.

A PR that changes behaviour without a test needs an explicit explanation in the description of why a test is impractical.

## Database changes

- The schema source of truth is `apps/api/prisma/schema.prisma`.
- Create migrations with `npm run db:migrate -- --name <description>` and commit the generated SQL with the schema change.
- Never edit a migration that has been merged to `main`; add a new one.
- Destructive migrations need a note in the PR describing the backup or backfill plan.

## Code conventions

- **Money** is an integer number of minor units (`BigInt`, serialised as decimal strings). Never use floats for amounts.
- **Rates** are per hour and **time** is per minute; use the shared helpers in `apps/api/src/domain/` rather than re-deriving arithmetic.
- **Invoice quantities** are thousandths and **tax** is basis points.
- **Calendar dates** cross the API as `YYYY-MM-DD` and are stored at UTC midnight.
- **Tenant isolation**: a resource that belongs to another workspace returns `404`, never `403`.
- **Errors**: throw `ApiError` helpers so the terminal handler can render the single JSON envelope.
- **Auditing**: writes that matter record an audit row in the same transaction as the change.
- **Permissions**: add to the catalogue in `apps/api/src/modules/workspaces/permissions.ts` and cover the role matrix in its unit test.

## Review and merging

- PRs are merged with a merge commit so the branch history and its review stay traceable.
- The PR title becomes the merge commit subject; keep it conventional.
- Required checks must be green before merge. Do not merge a red build, even when the failure looks unrelated — investigate first.
- Prefer asking a question in the PR over pushing a surprise refactor.

## Reporting bugs and security issues

Use the issue templates for reproducible bugs and feature requests. Do **not** open a public issue for a vulnerability; report it privately via GitHub's security advisory tab so a fix can ship before disclosure.
