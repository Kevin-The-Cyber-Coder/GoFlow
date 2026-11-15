# Architecture decisions

GoFlow keeps a lightweight decision log. An architecture decision record (ADR) captures a choice that is expensive to reverse, the context that forced it, and what it costs to live with. Code comments explain _what_ the code does; ADRs explain _why it is shaped that way_.

## Index

| ADR                                                     | Decision                                                            | Status   |
| ------------------------------------------------------- | ------------------------------------------------------------------- | -------- |
| [0001](0001-money-and-time-representation.md)           | Money, quantities, tax and dates use exact integer representations  | Accepted |
| [0002](0002-integration-tests-against-real-postgres.md) | Integration tests run against a real PostgreSQL server              | Accepted |
| [0003](0003-workspace-tenancy-and-rbac.md)              | Tenant scoping is enforced in queries, with a single role catalogue | Accepted |

## Writing a new ADR

1. Copy the structure of an existing record: title, status, date, context, decision, consequences, alternatives.
2. Number it with the next free four-digit prefix.
3. Add it to the table above in the same pull request as the change it describes.
4. Keep it short. If it needs a diagram, link one instead of pasting a wall of text.

Statuses are `Proposed`, `Accepted`, `Superseded by NNNN` or `Deprecated`. Never rewrite an accepted ADR to match new thinking — add a new one that supersedes it, so the reasoning stays auditable.
