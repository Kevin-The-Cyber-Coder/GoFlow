# ADR-005: Invoice totals, numbering and lifecycle

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** Project maintainer

## Context

Invoices are the core financial record, so three things must be true:

1. The numbers on screen must match the numbers on the PDF and in the database.
2. Two concurrent requests must never receive the same invoice number.
3. Editing an invoice that has already been sent to a client must be impossible.

Floating point is not an option: `0.1 + 0.2` is not `0.3`, and a cent lost per line
is a reconciliation bug that a client will notice.

## Decision

- **All amounts are integers in minor units**, held as `bigint` in Postgres and
  `bigint` in the calculation code. JSON carries them as safe integers; anything
  that does not fit is a 500 rather than a silently rounded value.
- **Quantities are integer milli-units** (1500 = 1.5). Users type decimal
  strings and the API parses them exactly.
- **One rounding rule:** half up, applied once per line subtotal and once per
  tax calculation. It is implemented in the shared, pure
  `calculateInvoice` so the API and the web client cannot disagree.
- **Invoice-level discounts are allocated across lines by cumulative rounded
  boundaries**, which guarantees the per-line discounts sum exactly to the
  invoice discount and line totals reconcile with the invoice total.
- **Tax is charged on the discounted base**, not the pre-discount subtotal.
- **Invoice numbers are reserved with a single `UPDATE ... RETURNING`** on the
  workspace counter inside the creating transaction. Concurrent creates
  serialise on the workspace row instead of racing on a `MAX(number)` query.
- **Totals are persisted** alongside the line items and recomputed in the same
  transaction as any change, so list and report queries never need to join the
  items table.
- **Lifecycle is separate from payment status.** `status` is one of `draft`,
  `sent`, `cancelled`, `void`; `paymentStatus` (`unpaid`, `partial`, `paid`,
  `overdue`) is derived from `amount_paid_minor`, the due date and the
  lifecycle. A cancelled invoice can still show money received against it.
- **Only drafts are editable or deletable.** Sending is the point of no return;
  a mistake after that is corrected by voiding, which keeps the audit trail.

## Alternatives considered

**Store amounts as `numeric` and compute in SQL.** Exact, but every consumer
would need the same rounding rules in two places, and the web client could not
preview totals without a round trip.

**Float columns.** Cheapest to write, and the wrong answer to the problem.

**Derive totals on read.** Always fresh, but every invoice list becomes an
aggregate over line items, and historic invoices would silently change if the
calculator changed. Persisting the computed values keeps sent invoices
immutable.

**Allocate discounts by rounding each line independently.** Simple, but the
parts occasionally differ from the whole by a cent. Cumulative boundaries are
only a few more lines and are always exact.

**`MAX(number) + 1` for numbering.** Races under concurrency and reuses numbers
after deletion. The counter lives on the workspace and only ever moves forward.

## Consequences

- The database needs `bigint` columns and the API must convert at the boundary;
  `toMinorNumber` refuses values outside `Number.MAX_SAFE_INTEGER`.
- Adding a tax rule (for example, per-region rates) means extending the pure
  calculator and its tests, not changing stored values.
- Voided and cancelled invoices remain in the list so history is complete;
  consumers filter on `status` or `paymentStatus`.
- Numbers have gaps if a draft is deleted after its number was allocated. That
  is standard accounting practice and preferable to reusing a number.
