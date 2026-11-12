# ADR-001: Monorepo architecture with npm workspaces

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** Project maintainer

## Context

GoFlow has two deployable applications (an Express API and a React client) that
share validation schemas, DTO types and money helpers. The client and server must
agree on those contracts exactly: a validation rule that differs between them is a
bug class, and a currency format that differs between them is a support ticket.

The project is developed by a small team under review-heavy conditions, so setup
and CI cost matter more than build-graph sophistication.

## Decision

A single repository with npm workspaces:

```
apps/api        @goflow/api
apps/web        @goflow/web
packages/shared @goflow/shared
```

- `packages/shared` is the single source of truth for cross-boundary contracts.
- Each workspace owns its `package.json`, scripts and TypeScript config.
- Root scripts (`build`, `lint`, `typecheck`, `test`) iterate workspaces; CI calls
  only those.
- `packages/shared` is built to `dist` on `npm install` via the root `prepare`
  script, so consumers resolve compiled JavaScript rather than source.

## Alternatives considered

**Two repositories.** Clean isolation and independent release cadence, but shared
contracts become either duplicated code or an extra published package. Both add
coordination overhead that this project cannot justify.

**Turborepo/Nx on top of workspaces.** Useful once the task graph is large and
build times hurt. Today the whole pipeline finishes in under a minute; a task
runner would add configuration and a cache to invalidate for no measured gain.

**A single package with a `server/` and `client/` folder.** Simplest possible
setup, but it blurs the boundary between code that runs on the server and code
that ships to the browser, which is exactly the boundary that matters for
security.

## Consequences

- One `npm install`, one lockfile, one CI workflow.
- A shared contract can be changed atomically in one commit and reviewed once.
- Workspace linking requires care: renaming a workspace without regenerating the
  lockfile leaves dangling `node_modules` symlinks (hit once during the rebrand).
- `npm` does not provide task caching. If build time becomes a problem, a task
  runner can be added without restructuring the repository.

## Implementation notes

- Root `tsconfig.base.json` holds strict defaults; each workspace extends it.
- ESLint runs once from the root with per-directory overrides rather than a
  config per workspace, so rules cannot drift.
- Docker builds copy manifests and `packages/shared` first, then `npm ci`, so the
  dependency layer is cached across source changes.
