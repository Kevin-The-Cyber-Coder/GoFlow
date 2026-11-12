# Architecture overview

GoFlow is a two-application monorepo built around a relational core.

```mermaid
flowchart LR
  subgraph Browser
    UI[React client<br/>Vite + Tailwind]
  end

  subgraph Server
    API[Express API<br/>/api/v1]
    Jobs[Background jobs]
  end

  DB[(PostgreSQL)]
  Mail[SMTP provider]
  Store[(Object storage)]

  UI -- HTTPS / JSON --> API
  API -- Drizzle + transactions --> DB
  Jobs -- reminders, recurring invoices --> DB
  Jobs --> Mail
  API --> Mail
  API --> Store
```

## Layers in the API

| Layer      | Responsibility                              |
| ---------- | ------------------------------------------- |
| Route      | Path and HTTP method, middleware wiring     |
| Controller | Request parsing, shaping the response       |
| Service    | Business rules, authorisation, transactions |
| Repository | SQL through Drizzle, no business rules      |
| Domain     | Pure functions: money, tax, status, dates   |

Rules that keep the boundaries honest:

- Controllers never touch the database directly.
- Services never read `req` or write `res`.
- Repositories never decide policy (no "if the user is an admin…").
- Anything financial that can be computed without I/O lives in a pure module and
  is unit-tested exhaustively.

## Request lifecycle

```mermaid
sequenceDiagram
  participant C as Client
  participant A as API
  participant S as Service
  participant D as Postgres

  C->>A: POST /api/v1/payments
  A->>A: authenticate, validate body
  A->>S: recordPayment(...)
  S->>D: BEGIN
  S->>D: SELECT invoice FOR UPDATE
  S->>D: INSERT payment
  S->>D: UPDATE invoice balance
  S->>D: INSERT audit log
  S->>D: COMMIT
  S-->>A: payment
  A-->>C: 201 Created
```

## Workspace isolation

Every business record belongs to a workspace. The authenticated user's workspace
membership is resolved once per request, and repositories always scope by
`workspace_id`. A record from another workspace is indistinguishable from a
missing record: the API returns `404`, never `403`.

## Error contract

All errors share one envelope:

```json
{ "error": { "code": "INVOICE_NOT_FOUND", "message": "Invoice not found." } }
```

Internal details are never returned in production responses.

## Related decisions

- [ADR-001](adr/ADR-001-project-architecture.md) — monorepo layout
- [ADR-002](adr/ADR-002-database-and-orm.md) — PostgreSQL and Drizzle
- [ADR-003](adr/ADR-003-money-representation.md) — integer minor units
