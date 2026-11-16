# GoFlow

GoFlow is a workspace for freelancers: clients, projects, tasks, tracked time and invoices in one place, built to answer the two questions that matter — _what do I owe my clients_ and _what am I owed_.

This repository contains the REST API, the database schema and the web client that will consume it.

## What is here

- **Multi-tenant workspaces** with role-based access control (owner, admin, project manager, accountant, employee, viewer).
- **Authentication** with 15-minute HS256 access tokens and opaque, rotating refresh sessions with replay detection.
- **Clients CRM** with contacts, tags, archival and CSV import/export (RFC 4180 parser, dry-run mode, column aliases).
- **Projects** with budgets, delivery summaries and a task board with per-column ordering.
- **Time tracking** with per-project rate inheritance, billable flags and period summaries by user, project and day.
- **Invoices** with line items, discounts, tax, atomic per-workspace numbering, issue/void lifecycle and audit rows.
- **Audit log** written in the same transaction as the change it records.

## Stack

| Layer    | Choice                                      |
| -------- | ------------------------------------------- |
| Runtime  | Node.js 22+ (CI uses 24), TypeScript 5.7    |
| API      | Express 5, Zod validation, Jest + Supertest |
| Database | PostgreSQL 17, Prisma 6.19                  |
| Web      | React 19, Vite 6, Tailwind CSS 4            |
| Tooling  | npm workspaces, ESLint 10, Prettier 3       |

## Repository layout

```
apps/api/          Express API, Prisma schema and migrations, integration harness
apps/web/          React client (Vite)
packages/shared/   Money helpers shared by API and web
docker/            Images and Postgres bootstrap for Compose
docs/              Architecture decision records and guides
```

## Quick start

Prerequisites: Node.js 22 or newer, npm 10 or newer, and a PostgreSQL 15+ server (17 in CI). Docker is optional but convenient.

```bash
# 1. Install dependencies (also generates the Prisma client)
npm ci

# 2. Configure the environment
cp .env.example .env          # Windows: copy .env.example .env

# 3. Start PostgreSQL (or point DATABASE_URL at an existing server)
docker compose up -d postgres
# No Docker? `npm run db:dev` starts a persistent embedded PostgreSQL on
# port 55432 in ~/.goflow/postgres and prints the DATABASE_URL to use.

# 4. Apply the schema
npm run db:deploy            # migrations only; use `npm run db:migrate` while developing

# 5. Seed a demo workspace (optional)
npm run db:seed              # demo@goflow.test / Password123!

# 6. Run both apps
npm run dev:api              # http://localhost:3000
npm run dev:web              # http://localhost:5173
```

Health check: `GET http://localhost:3000/api/v1/health`.

### Configuration

Values are read from the environment (`.env` for local development).

| Variable                     | Default                | Purpose                                                |
| ---------------------------- | ---------------------- | ------------------------------------------------------ |
| `DATABASE_URL`               | — (required)           | PostgreSQL connection string                           |
| `NODE_ENV`                   | `development`          | `development`, `test` or `production`                  |
| `PORT`                       | `3000`                 | API listen port for a host process                     |
| `JWT_ACCESS_SECRET`          | development-only value | HMAC secret; **required, min 32 chars, in production** |
| `JWT_ACCESS_TTL_SECONDS`     | `900`                  | Access token lifetime                                  |
| `REFRESH_TTL_DAYS`           | `30`                   | Refresh session lifetime                               |
| `PASSWORD_RESET_TTL_MINUTES` | `60`                   | Password reset token lifetime                          |
| `TRUST_PROXY`                | unset                  | Set to `1` behind one trusted proxy hop                |

### Scripts

| Command                            | What it does                                       |
| ---------------------------------- | -------------------------------------------------- |
| `npm run dev:api` / `dev:web`      | Watch-mode development servers                     |
| `npm run build`                    | Build shared, API and web in dependency order      |
| `npm run lint` / `lint:fix`        | ESLint over the whole repository                   |
| `npm run format` / `format:check`  | Prettier write / verify                            |
| `npm run typecheck`                | `tsc --noEmit` in every workspace                  |
| `npm test`                         | Unit tests (no database required)                  |
| `npm run test:integration`         | Integration tests against a real PostgreSQL server |
| `npm run db:migrate` / `db:deploy` | Create a migration / apply committed migrations    |
| `npm run db:dev`                   | Start a persistent embedded PostgreSQL (no Docker) |
| `npm run db:seed`                  | Populate the demo workspace                        |
| `npm run db:studio`                | Open Prisma Studio                                 |

## API

Base path: `/api/v1`. Authenticated requests send `Authorization: Bearer <access-token>` and a workspace scope via `X-Workspace-Id: <workspace-id>`.

| Module     | Prefix        | Notes                                                                   |
| ---------- | ------------- | ----------------------------------------------------------------------- |
| Health     | `/health`     | Liveness check with process uptime                                      |
| Auth       | `/auth`       | register, login, refresh, logout, logout-all, sessions, password change |
| Workspaces | `/workspaces` | workspaces, role catalogue, members, ownership transfer                 |
| User       | `/users/me`   | profile preferences and account closure                                 |
| Clients    | `/clients`    | CRUD, contacts, archive/restore, `/import`, `/export`                   |
| Projects   | `/projects`   | CRUD, archive/restore, nested `/tasks` and `/tasks/reorder`             |
| Time       | `/time`       | `/entries` CRUD and `/summary`                                          |
| Invoices   | `/invoices`   | drafts, items, `/issue`, `/void`                                        |
| Payments   | `/payments`   | ledger, idempotent record, `/reverse`, derived invoice status           |
| Expenses   | `/expenses`   | categories, CRUD, submission and review, date and vendor filters        |
| Reports    | `/reports`    | `/summary` income, spending, net and outstanding for one currency       |
| Audit      | `/audit`      | workspace trail, filtered by action, entity, actor and date             |

```bash
# Register (creates a personal workspace) and capture tokens
curl -s -X POST http://localhost:3000/api/v1/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"me@example.com","password":"Str0ngPassword!","name":"Sam Freelancer"}'

# List clients in that workspace
curl -s http://localhost:3000/api/v1/clients \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -H "x-workspace-id: $WORKSPACE_ID"
```

## Conventions that matter

- **Money is integer minor units** (`BigInt`, serialised as decimal strings); currencies are ISO 4217 codes. Hourly rates are per hour and time is per minute, so shared arithmetic sums products first and divides by 60 once, rounding half-up.
- **Invoice quantities are thousandths** of a unit and **tax is basis points** (19% VAT = `1900`), so no float ever touches an amount.
- **Calendar dates are exchanged as `YYYY-MM-DD`** and stored at UTC midnight; impossible dates such as `2026-02-31` are rejected.
- **Cross-tenant reads return `404`, not `403`**, so a foreign id cannot be used to probe for existence.
- **Expected failures throw `ApiError`**, which the terminal handler renders as one JSON envelope.
- **Audit rows accompany writes inside the same transaction**, so a rollback cannot leave a misleading audit entry.

The role/permission catalogue lives in `apps/api/src/modules/workspaces/permissions.ts` and is covered by unit tests.

## Testing

Unit tests need nothing but Node:

```bash
npm test
```

Integration tests exercise the real HTTP stack and a real PostgreSQL database — no in-memory SQL emulation:

```bash
npm run test:integration
```

If `DATABASE_URL` is unset the harness starts an embedded PostgreSQL instance, applies `prisma migrate deploy`, and tears the server down afterwards. In CI the same suite runs against a `postgres:17-alpine` service container (`.github/workflows/ci.yml`).

Every test file truncates the database between cases, and integration tests cover permission boundaries and cross-workspace isolation as first-class cases.

## Status

Implemented: authentication and sessions, workspaces and RBAC, clients and CSV, projects and board tasks, time tracking, invoice drafting and lifecycle.

Next: report exports, notifications, security hardening, the web application shell, invoice PDFs, and end-to-end browser tests.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, branch naming, commit conventions and the review checklist. Architecture decisions are recorded in [`docs/architecture/`](docs/architecture/).

## Security

Please report vulnerabilities privately through the [security policy](SECURITY.md) rather than in a public issue.

## License

MIT — see [LICENSE](LICENSE).
