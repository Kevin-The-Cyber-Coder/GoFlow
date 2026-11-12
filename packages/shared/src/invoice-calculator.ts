/**
 * Invoice totals.
 *
 * Pure bigint arithmetic — no `number` ever holds an amount — with one explicit
 * rounding rule: half up, applied once per line and once per tax calculation.
 * The intent is that two people implementing the same tax table get the same
 * cent, and that the printed line items always add up to the printed total.
 */

export interface InvoiceLineInput {
  quantityMilli: number;
  unitPriceMinor: bigint;
  taxRateBps: number;
}

export type InvoiceDiscount =
  { type: 'none' } | { type: 'fixed'; amountMinor: bigint } | { type: 'percent'; rateBps: number };

export interface CalculatedLine {
  subtotalMinor: bigint;
  discountMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
}

export interface InvoiceTotals {
  subtotalMinor: bigint;
  discountMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
  lines: CalculatedLine[];
}

const QUANTITY_SCALE = 1_000n;
const BASIS_POINT_SCALE = 10_000n;

/** Half-up rounding for non-negative bigints. */
function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}

function assertLines(lines: readonly InvoiceLineInput[]): void {
  if (lines.length === 0) {
    throw new RangeError('An invoice needs at least one line.');
  }

  for (const line of lines) {
    if (!Number.isSafeInteger(line.quantityMilli) || line.quantityMilli <= 0) {
      throw new RangeError('Quantity must be a positive number.');
    }

    if (line.unitPriceMinor < 0n) {
      throw new RangeError('Unit price must not be negative.');
    }

    if (
      !Number.isInteger(line.taxRateBps) ||
      line.taxRateBps < 0 ||
      line.taxRateBps > Number(BASIS_POINT_SCALE)
    ) {
      throw new RangeError('Tax rate must be between 0 and 10000 basis points.');
    }
  }
}

function discountTotalFor(subtotal: bigint, discount: InvoiceDiscount): bigint {
  switch (discount.type) {
    case 'none':
      return 0n;
    case 'fixed': {
      if (discount.amountMinor < 0n) {
        throw new RangeError('Discount must not be negative.');
      }
      return discount.amountMinor > subtotal ? subtotal : discount.amountMinor;
    }
    case 'percent': {
      if (
        !Number.isInteger(discount.rateBps) ||
        discount.rateBps < 0 ||
        discount.rateBps > Number(BASIS_POINT_SCALE)
      ) {
        throw new RangeError('Discount rate must be between 0 and 10000 basis points.');
      }
      return divRoundHalfUp(subtotal * BigInt(discount.rateBps), BASIS_POINT_SCALE);
    }
  }
}

export function calculateInvoice(
  lines: readonly InvoiceLineInput[],
  discount: InvoiceDiscount = { type: 'none' },
): InvoiceTotals {
  assertLines(lines);

  const subtotals = lines.map((line) =>
    divRoundHalfUp(BigInt(line.quantityMilli) * line.unitPriceMinor, QUANTITY_SCALE),
  );

  const subtotalMinor = subtotals.reduce((total, value) => total + value, 0n);
  const discountMinor = discountTotalFor(subtotalMinor, discount);

  // Allocate the discount across lines proportionally to their subtotal using
  // cumulative rounded boundaries. Cumulatively rounding (rather than rounding
  // each line independently) guarantees the allocations sum to the discount
  // exactly, so line totals always reconcile with the invoice total.
  let cumulativeSubtotal = 0n;
  let cumulativeDiscount = 0n;

  const calculated: CalculatedLine[] = lines.map((line, index) => {
    const lineSubtotal = subtotals[index] ?? 0n;
    cumulativeSubtotal += lineSubtotal;

    const targetDiscount =
      subtotalMinor === 0n ? 0n : divRoundHalfUp(discountMinor * cumulativeSubtotal, subtotalMinor);

    const lineDiscount = targetDiscount - cumulativeDiscount;
    cumulativeDiscount = targetDiscount;

    const taxableBase = lineSubtotal - lineDiscount;
    const taxMinor = divRoundHalfUp(
      (taxableBase > 0n ? taxableBase : 0n) * BigInt(line.taxRateBps),
      BASIS_POINT_SCALE,
    );

    return {
      subtotalMinor: lineSubtotal,
      discountMinor: lineDiscount,
      taxMinor,
      totalMinor: lineSubtotal - lineDiscount + taxMinor,
    };
  });

  const taxMinor = calculated.reduce((total, line) => total + line.taxMinor, 0n);

  return {
    subtotalMinor,
    discountMinor,
    taxMinor,
    totalMinor: subtotalMinor - discountMinor + taxMinor,
    lines: calculated,
  };
}
