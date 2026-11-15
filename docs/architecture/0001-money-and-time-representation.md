# ADR 0001: Exact representations for money, quantities and dates

- **Status:** Accepted
- **Date:** 2026-11-15

## Context

A freelancer platform is mostly arithmetic: hours times rates, invoice lines with discounts and tax, payments against a total, summaries across a date range. Floating point makes that arithmetic subtly wrong — `0.1 + 0.2` is not `0.3`, and repeated per-entry rounding accumulates into invoices that are off by cents. A client noticing a one-cent discrepancy in an invoice costs more trust than the bug is worth.

The database is PostgreSQL, which has exact `numeric`, but JavaScript has no decimal type and Prisma maps `numeric` to `Decimal` objects that need a runtime library and still leave the rounding policy to each caller.

Dates have a similar trap: a calendar date is not an instant. Parsing `2026-02-31` with `Date.parse` silently rolls into March, which is unacceptable for invoice due dates.

## Decision

- **Money is an integer number of minor units**, stored as `BigInt` and exchanged over HTTP as a decimal string (`"125050"` is 1,250.50 in a two-decimal currency). Every row that carries an amount also carries an ISO 4217 currency code.
- **Hourly rates are per hour; time is per minute.** Shared helpers in `apps/api/src/domain/billing.ts` sum `minutes × rate` products and divide by 60 **once**, rounding half-up, so per-entry truncation cannot under-bill a long project.
- **Invoice quantities are thousandths of a unit** and **tax is basis points** (19% = `1900`). Discounts are absolute minor units per line.
- **All rounding is half-up and happens once per computed figure.** `domain/invoice.ts` guarantees `total = subtotal - discount + tax` for each line and for the invoice.
- **Calendar dates cross the API as `YYYY-MM-DD`** and are stored at UTC midnight. Validation round-trips the value through `Date` and compares the string back, so `2026-02-31` is a validation error rather than a silent March date.

## Consequences

- No float or decimal dependency in the runtime; arithmetic is plain integer maths and is covered by unit tests at the boundaries (half a minor unit, repeated lines, zero-value lines).
- Clients must treat `*Minor` fields as strings. This is explicit in the API and prevents a JavaScript client from rounding through `Number` above 2^53.
- All supported currencies are assumed to have two decimal places until a currency-scale table exists. This is a known limitation, recorded here rather than hidden: a currency with zero or three decimals would need a scale lookup before it can be billed correctly.
- Database aggregates such as `sum(totalMinor)` are exact `int8` sums, so reporting does not need to load every row into the application.
- Dates are date-only by design; timestamps (`createdAt`, `sentAt`, `paidAt`) remain true instants in UTC.

## Alternatives considered

- **Floating point** — rejected: unacceptable drift in invoices.
- **PostgreSQL `numeric` with a decimal library** — exact, but adds a dependency and still requires a project-wide rounding policy. It remains a reasonable choice for a future analytics warehouse.
- **Storing formatted amounts** — rejected: makes aggregation and refund arithmetic unreliable.
- **Timestamps for calendar dates** — rejected: timezone conversions turn `2026-03-01` into `2026-02-28` for users west of UTC.
