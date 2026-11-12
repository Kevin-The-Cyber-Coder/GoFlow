# GoFlow

A freelancer business management platform: clients, projects, invoices, payments,
expenses and income reporting in one workspace.

Built as a production-style monorepo: strict TypeScript, a versioned REST API, a
relational schema with real constraints, and tests at unit, integration and
browser level.

## Status

This repository is under active development. The roadmap below reflects what is
merged, not what is planned.

| Area                        | Status |
| --------------------------- | ------ |
| Monorepo, tooling, CI       | ✅     |
| Docker development stack    | ✅     |
| Authentication and sessions | 🚧     |
| Clients (CRM)               | 🚧     |
| Invoices, tax and discounts | 🚧     |
| Payments and reconciliation | 🚧     |
| Reports and dashboards      | 🚧     |

## Stack

| Layer          | Choice                                           |
| -------------- | ------------------------------------------------ |
| Frontend       | React 19, TypeScript, Vite, Tailwind CSS 4       |
| Backend        | Node.js, Express 5, TypeScript                   |
| Database       | PostgreSQL, Drizzle ORM, SQL migrations          |
| Validation     | Zod (shared between API and web)                 |
| Testing        | Jest, Supertest, Playwright                      |
| Tooling        | npm workspaces, ESLint 9 (flat config), Prettier |
| Infrastructure | Docker, Docker Compose, GitHub Actions           |

Money is stored as `bigint` minor units plus an ISO 4217 currency code. No
financial value ever passes through a JavaScript float — see
[ADR-003](docs/adr/ADR-003-money-representation.md).

## Repository layout

```
apps/
  api/          Express API (routes, services, repositories)
  web/          React client (Vite, Tailwind)
packages/
  shared/       Contracts and pure helpers used by both apps
docker/         Dockerfiles, nginx and Postgres init scripts
docs/
  adr/          Architecture decision records
.github/        CI workflows, PR and issue templates
```

## Prerequisites

- Node.js 24 (see `.nvmrc`)
- npm 11
- Docker Desktop (optional, for the containerised stack)

## Getting started

### With Docker

```bash
cp .env.example .env
docker compose up --build
```

- Web: http://localhost:5173
- API: http://localhost:3000/api/v1/health
- Postgres: `localhost:5432`

`docker compose down` stops the stack; add `-v` to drop the database volume.

### Without Docker

```bash
npm install
npm run dev:api   # API on :3000
npm run dev:web   # web on :5173, proxying /api to the API
```

The API needs a Postgres instance reachable through `DATABASE_URL`; it is read
from the environment, with `.env.example` as the documented template.

> Windows PowerShell blocks `npm.ps1` under the default execution policy. Use
> `npm.cmd` or run the commands from `cmd`.

## Scripts

| Command                 | Purpose                      |
| ----------------------- | ---------------------------- |
| `npm run dev:api`       | API with reload              |
| `npm run dev:web`       | Vite dev server              |
| `npm run build`         | Build shared, API and web    |
| `npm run lint`          | ESLint across the monorepo   |
| `npm run format`        | Prettier write               |
| `npm run format:check`  | Prettier check (CI)          |
| `npm run typecheck`     | `tsc --noEmit` per workspace |
| `npm test`              | Jest per workspace           |
| `npm run test:coverage` | Jest with coverage           |

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md). In short: one branch per change,
Conventional Commits, tests with the change, and a PR that explains why.

## Security

Do not open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md).

## Architecture decisions

- [ADR-001 — Monorepo architecture](docs/adr/ADR-001-project-architecture.md)
- [ADR-002 — PostgreSQL, Drizzle and migrations](docs/adr/ADR-002-database-and-orm.md)
- [ADR-003 — Integer minor units for money](docs/adr/ADR-003-money-representation.md)

## Licence

Not yet decided. Until a licence is added, all rights are reserved.
