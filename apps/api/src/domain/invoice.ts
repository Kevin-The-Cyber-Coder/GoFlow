/**
 * Invoice arithmetic.
 *
 * Money is integer minor units and quantities are thousandths of a unit
 * (`quantityMilli`), so a line is `quantityMilli x unitPriceMinor / 1000`.
 * Every division rounds half-up and happens once per quantity, discount and
 * tax figure — never cumulatively — so a long invoice cannot drift by cents.
 *
 * All inputs are validated to be non-negative by the request schema, which
 * lets this module stay a pure function of its arguments.
 */
export interface InvoiceLineInput {
  readonly quantityMilli: number;
  readonly unitPriceMinor: bigint;
  readonly discountMinor: bigint;
  readonly taxRateBps: number;
}

export interface InvoiceLineTotals {
  /** Quantity x unit price before any discount. */
  readonly grossMinor: bigint;
  readonly netMinor: bigint;
  /** Tax on the net amount, in minor units. */
  readonly taxMinor: bigint;
  readonly totalMinor: bigint;
}

export interface InvoiceTotals {
  readonly subtotalMinor: bigint;
  readonly discountMinor: bigint;
  readonly taxMinor: bigint;
  readonly totalMinor: bigint;
}

/** Rounds a non-negative rational amount half-up to a whole minor unit. */
export function divideRoundHalfUp(dividend: bigint, divisor: bigint): bigint {
  if (dividend < 0n || divisor <= 0n) {
    throw new RangeError('Half-up rounding is only defined for non-negative amounts.');
  }
  const quotient = dividend / divisor;
  const remainder = dividend % divisor;
  return remainder * 2n >= divisor ? quotient + 1n : quotient;
}

export function lineGrossMinor(quantityMilli: number, unitPriceMinor: bigint): bigint {
  if (!Number.isInteger(quantityMilli) || quantityMilli < 0) {
    throw new RangeError('Quantity must be a non-negative whole number of thousandths.');
  }
  return divideRoundHalfUp(BigInt(quantityMilli) * unitPriceMinor, 1_000n);
}

export function lineTotals(line: InvoiceLineInput): InvoiceLineTotals {
  const grossMinor = lineGrossMinor(line.quantityMilli, line.unitPriceMinor);
  const netMinor = grossMinor - line.discountMinor;
  const taxMinor = divideRoundHalfUp(netMinor * BigInt(line.taxRateBps), 10_000n);
  return { grossMinor, netMinor, taxMinor, totalMinor: netMinor + taxMinor };
}

/**
 * Sums line totals. `subtotalMinor` is the pre-discount sum, so the identity
 * `total = subtotal - discount + tax` holds for the invoice as a whole.
 */
export function invoiceTotals(lines: readonly InvoiceLineInput[]): InvoiceTotals {
  let subtotalMinor = 0n;
  let discountMinor = 0n;
  let taxMinor = 0n;
  let totalMinor = 0n;

  for (const line of lines) {
    const totals = lineTotals(line);
    subtotalMinor += totals.grossMinor;
    discountMinor += line.discountMinor;
    taxMinor += totals.taxMinor;
    totalMinor += totals.totalMinor;
  }

  return { subtotalMinor, discountMinor, taxMinor, totalMinor };
}
