# ADR 0003: Workspace tenancy and role-based access control

- **Status:** Accepted
- **Date:** 2026-11-15

## Context

A freelancer may work alone today and invite a collaborator, an accountant or a client-facing project manager tomorrow. All of those people share one workspace, and none of them may see another workspace's clients, invoices or time. The platform also needs a small, predictable set of roles rather than a per-user permission editor: freelancers should not have to design an authorisation model before sending an invoice.

The API is the only place where tenancy can be enforced, because the web client is untrusted and may be replaced by a script or a future mobile app.

## Decision

- **Every tenant-owned row carries `workspaceId`**, and every query that reads or writes one filters on the workspace resolved from the request. There is no "global" resource table.
- **The workspace is resolved once per request** from the `:workspaceId` route parameter, then the `X-Workspace-Id` header, then the user's first membership — and membership is required in every case. A forged id can only narrow access, never widen it.
- **A resource that exists in another workspace returns `404`, not `403`.** A 403 confirms that the id is real, which leaks tenant existence; a 404 is indistinguishable from a genuinely missing id.
- **Permissions are a single catalogue** (`Permission` union) mapped to immutable role sets in `apps/api/src/modules/workspaces/permissions.ts`. Routes declare `requirePermission('invoices:write')`; service code asks `can(role, 'time:manage')` when a rule is conditional.
- **Ownership is checked separately from the role.** An employee may edit their own time entries, but a colleague's entry is a `404` unless the caller holds `time:manage`.
- **The owner role is defined as the superset of every permission**, and a unit test asserts it. Adding a permission without granting it to the owner fails the suite.

## Consequences

- Authorisation is explicit at each route and testable without HTTP; the role matrix is a pure data structure with its own tests.
- Cross-tenant leakage is covered as a first-class test case in every module rather than assumed from the scoping pattern.
- Application-level enforcement means one missed `workspaceId` filter is a real vulnerability. PostgreSQL row-level security would be defence in depth; it is deliberately deferred until the schema and access paths stabilise, and would be recorded as a superseding ADR.
- Role changes are coarse: a user who needs one extra capability gets a whole role. If real demand appears, per-member overrides would be a new ADR rather than an ad-hoc permission column.
- The permission names are part of the public API surface (`GET /workspaces/roles`), so renaming one is a breaking change.

## Alternatives considered

- **PostgreSQL row-level security from day one** — strong, but needs a connection-scoped tenant variable on every pooled connection and complicates migrations and tests. Revisit as defence in depth.
- **Per-tenant schemas or databases** — isolation is excellent, but migrations, backups and cross-workspace reporting become much harder for a product aimed at solo freelancers.
- **Attribute-based access control** — flexible, but it pushes authorisation design onto users and makes the permission model impossible to document in a table.
- **Returning `403` for foreign ids** — rejected for the existence-leak reason above.
