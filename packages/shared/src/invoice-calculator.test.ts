import { describe, expect, it } from '@jest/globals';

import { calculateInvoice } from './invoice-calculator';

const line = (overrides: Partial<Parameters<typeof calculateInvoice>[0][number]> = {}) => ({
  quantityMilli: 1_000,
  unitPriceMinor: 10_000n,
  taxRateBps: 0,
  ...overrides,
});

describe('calculateInvoice', () => {
  it('computes a single untaxed line', () => {
    const totals = calculateInvoice([line()]);

    expect(totals).toMatchObject({
      subtotalMinor: 10_000n,
      discountMinor: 0n,
      taxMinor: 0n,
      totalMinor: 10_000n,
    });
  });

  it('applies tax to the line subtotal', () => {
    const totals = calculateInvoice([line({ taxRateBps: 2_000 })]);

    expect(totals.taxMinor).toBe(2_000n);
    expect(totals.totalMinor).toBe(12_000n);
  });

  it('rounds fractional quantities half up', () => {
    // 1.5 × 33.33 = 49.995 → 50.00
    const totals = calculateInvoice([line({ quantityMilli: 1_500, unitPriceMinor: 3_333n })]);

    expect(totals.subtotalMinor).toBe(5_000n);
  });

  it('rounds tax half up', () => {
    // 10.01 at 7.5% = 0.75075 → 0.75
    const totals = calculateInvoice([line({ unitPriceMinor: 1_001n, taxRateBps: 750 })]);

    expect(totals.taxMinor).toBe(75n);
  });

  it('applies a percentage discount before tax', () => {
    const totals = calculateInvoice([line({ taxRateBps: 2_000 })], {
      type: 'percent',
      rateBps: 1_000,
    });

    expect(totals.subtotalMinor).toBe(10_000n);
    expect(totals.discountMinor).toBe(1_000n);
    // Tax is charged on 90.00, not 100.00.
    expect(totals.taxMinor).toBe(1_800n);
    expect(totals.totalMinor).toBe(10_800n);
  });

  it('clamps a fixed discount at the subtotal', () => {
    const totals = calculateInvoice([line()], { type: 'fixed', amountMinor: 99_999n });

    expect(totals.discountMinor).toBe(10_000n);
    expect(totals.taxMinor).toBe(0n);
    expect(totals.totalMinor).toBe(0n);
  });

  it('allocates a discount across lines so the parts sum to the whole', () => {
    const totals = calculateInvoice(
      [
        line({ unitPriceMinor: 3_333n }),
        line({ unitPriceMinor: 3_333n }),
        line({ unitPriceMinor: 3_334n }),
      ],
      { type: 'percent', rateBps: 333 },
    );

    const allocated = totals.lines.reduce((total, current) => total + current.discountMinor, 0n);

    expect(allocated).toBe(totals.discountMinor);
    expect(totals.totalMinor).toBe(totals.subtotalMinor - totals.discountMinor + totals.taxMinor);
  });

  it('keeps line totals reconciling with the invoice total', () => {
    const totals = calculateInvoice(
      [
        line({ quantityMilli: 1_500, unitPriceMinor: 2_499n, taxRateBps: 1_900 }),
        line({ unitPriceMinor: 999n, taxRateBps: 700 }),
        line({ quantityMilli: 250, unitPriceMinor: 12_000n, taxRateBps: 0 }),
      ],
      { type: 'percent', rateBps: 750 },
    );

    const lineTotal = totals.lines.reduce((total, current) => total + current.totalMinor, 0n);

    expect(lineTotal).toBe(totals.totalMinor);
  });

  it('handles a zero subtotal with a percentage discount', () => {
    const totals = calculateInvoice([line({ unitPriceMinor: 0n, taxRateBps: 2_000 })], {
      type: 'percent',
      rateBps: 1_000,
    });

    expect(totals.totalMinor).toBe(0n);
    expect(totals.lines[0]?.discountMinor).toBe(0n);
  });

  it('rejects an empty invoice', () => {
    expect(() => calculateInvoice([])).toThrow(RangeError);
  });

  it('rejects non-positive quantities', () => {
    expect(() => calculateInvoice([line({ quantityMilli: 0 })])).toThrow(RangeError);
  });

  it('rejects negative prices', () => {
    expect(() => calculateInvoice([line({ unitPriceMinor: -1n })])).toThrow(RangeError);
  });

  it('rejects a tax rate outside 0–100%', () => {
    expect(() => calculateInvoice([line({ taxRateBps: 10_001 })])).toThrow(RangeError);
  });

  it('rejects a negative fixed discount', () => {
    expect(() => calculateInvoice([line()], { type: 'fixed', amountMinor: -1n })).toThrow(
      RangeError,
    );
  });
});
