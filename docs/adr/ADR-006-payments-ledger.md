# ADR-006: Payments as an append-only ledger

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** Project maintainer

## Context

`invoices.amount_paid_minor` drives `paymentStatus`, the outstanding balance and
later reporting. It could be a number an accountant edits directly, or it could
be derived from individual payments. The first is easy but unauditable; the
second needs to stay consistent under concurrent requests.

## Decision

- **Payments are rows**, not a mutable total. Each row records amount, method,
  reference, paid-at timestamp and optional notes, and belongs to exactly one
  invoice and workspace.
- **`invoices.amount_paid_minor` is a cache** of the ledger sum. It exists so
  lists and reports never aggregate payments, and it is written only in the
  same transaction as the ledger change.
- **The invoice row is locked with `SELECT ... FOR UPDATE`** before reading the
  balance. Two concurrent payments serialise on the invoice, so neither can act
  on a stale balance.
- **Payments may not exceed the outstanding balance.** An accidental extra zero
  becomes a `409 PAYMENT_EXCEEDS_BALANCE` instead of a negative balance.
- **Only sent invoices accept payments.** Drafts are not yet issued, and
  cancelled or voided invoices are closed records.
- **Deleting a payment is allowed and recomputes the cached total from the
  remaining rows.** A typo should be correctable without a compensating
  adjustment, and recomputing is safer than subtracting.
- **Payment currency is the invoice currency**, not client input.
- **Amounts remain integer minor units**, like every other monetary value.

## Alternatives considered

**Store only `amount_paid_minor` and let users edit it.** No history of when or
how money arrived, and no way to explain the balance later.

**Compute the paid total on every read.** Always consistent, but turns every
invoice list into an aggregate and makes historic balances depend on the current
ledger rather than the state at the time.

**Allow overpayment and clamp.** Hides mistakes and creates a credit balance the
product does not model yet. Rejecting is honest and reversible.

**Soft-delete payments with a `deleted_at` flag.** Keeps an audit trail, but
then every sum must filter and "delete" semantics leak into reports. The ledger
is small and corrections are expected to be rare; a future audit log can record
the deletion separately.

## Consequences

- Concurrent payments remain correct without application-level locking, because
  the database serialises on the invoice row.
- A payment on a voided invoice is refused; refunds are a future feature rather
  than a negative payment today.
- Voiding an invoice that already has payments does not erase them. Payment
  status continues to reflect money received, which is the truthful state.
- `sumPayments` casts the sum to text before converting to `bigint` so no driver
  precision is lost.
