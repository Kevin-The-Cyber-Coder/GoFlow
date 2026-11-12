# ADR-003: Money as integer minor units

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** Project maintainer

## Context

The product computes subtotals, discounts, taxes, partial payments, refunds and
report totals. Every one of those is a place where a rounding decision can turn
into a wrong number on an invoice.

JavaScript has no decimal type. `0.1 + 0.2` is `0.30000000000000004`. A
`number`-based invoice total is therefore wrong by construction, even before
anyone adds tax.

Currencies also differ: USD and EUR have two decimal places, JPY and KRW have
none, KWD and BHD have three.

## Decision

- Persist money as `bigint` in the currency's **minor unit** (cents, yen, fils).
- Store the ISO 4217 currency code next to every amount.
- Do all arithmetic in `bigint` on the server.
- Parse and format at the boundaries only, using
  `packages/shared/src/money.ts`.
- Reject input with more decimal places than the currency supports instead of
  rounding it silently.

Database columns are `amount_minor bigint`, `currency char(3)`. Tax rates are
integer basis points (`2000` = 20%). Quantities are integer milli-units.

## Alternatives considered

**`float` / `double precision`.** Unacceptable for money. Non-negotiable.

**`numeric(12,2)` in Postgres with a decimal library in Node.** Correct in the
database, but every service must remember to use `Decimal` rather than a `number`.
One `Number(row.amount)` anywhere in the stack reintroduces the bug, and the type
system cannot catch it because the column arrives as a string.

**`numeric` plus `big.js` everywhere.** Workable, but adds object allocation on
every arithmetic step and a second numeric type to reason about across API, DTOs
and tests.

**Integer minor units.** One representation everywhere: database, API JSON,
TypeScript and tests. Integers are exact, comparison is trivial, and "the number
is off by a cent" cannot come from representation error.

## Consequences

- Amounts in JSON are integers (`1050`), never decimals. Clients format for
  display using the shared helper so the web app and PDFs agree.
- Every amount must carry its currency; adding two different currencies is a
  programming error and is rejected.
- Zero-decimal and three-decimal currencies are handled explicitly. Unknown
  currency codes are rejected rather than assumed to have two decimals.
- Rounding is still a product decision for percentage calculations (tax, discount
  allocation). It is centralised in the financial engine with its own tests rather
  than scattered through handlers.
- Report aggregates remain exact regardless of how many rows are summed.

## Implementation notes

`packages/shared/src/money.ts` provides:

- `parseAmountToMinor(input, currency)` — strict parsing, rejects separators,
  exponent notation and excess decimal places.
- `formatMinor(minor, currency, locale)` — builds the fractional part from the
  integer so no amount passes through a float, even during formatting.
- `currencyExponent(currency)` — explicit table for zero- and three-decimal
  currencies.

Unit tests cover two-, three- and zero-decimal currencies, negatives, values
above `Number.MAX_SAFE_INTEGER`, and every rejection path.
