import { describe, expect, it } from '@jest/globals';

import { divideRoundHalfUp, invoiceTotals, lineGrossMinor, lineTotals } from './invoice';

describe('divideRoundHalfUp', () => {
  it('rounds the exact half up and anything below it down', () => {
    expect(divideRoundHalfUp(5n, 10n)).toBe(1n);
    expect(divideRoundHalfUp(4n, 10n)).toBe(0n);
    expect(divideRoundHalfUp(15n, 10n)).toBe(2n);
  });

  it('rejects negative dividends instead of guessing a rounding direction', () => {
    expect(() => divideRoundHalfUp(-1n, 10n)).toThrow(RangeError);
    expect(() => divideRoundHalfUp(1n, 0n)).toThrow(RangeError);
  });
});

describe('lineGrossMinor', () => {
  it('expands a thousandth-quantity into whole minor units', () => {
    // 2.500 units x 120.00 = 300.00
    expect(lineGrossMinor(2_500, 12_000n)).toBe(30_000n);
  });

  it('rounds a fractional cent half-up exactly once', () => {
    // 0.001 units x 0.01 = 0.00001, which is below half a cent.
    expect(lineGrossMinor(1, 1n)).toBe(0n);
    // 0.001 units x 0.50 = 0.0005, exactly half a cent.
    expect(lineGrossMinor(1, 500n)).toBe(1n);
  });
});

describe('lineTotals', () => {
  it('applies the discount before tax and reports a consistent total', () => {
    const totals = lineTotals({
      quantityMilli: 1_000,
      unitPriceMinor: 10_000n,
      discountMinor: 1_000n,
      taxRateBps: 1_900,
    });

    expect(totals).toEqual({
      grossMinor: 10_000n,
      netMinor: 9_000n,
      taxMinor: 1_710n,
      totalMinor: 10_710n,
    });
  });

  it('treats a zero tax rate as untaxed', () => {
    const totals = lineTotals({
      quantityMilli: 2_000,
      unitPriceMinor: 5_000n,
      discountMinor: 0n,
      taxRateBps: 0,
    });

    expect(totals.taxMinor).toBe(0n);
    expect(totals.totalMinor).toBe(totals.grossMinor);
  });
});

describe('invoiceTotals', () => {
  it('sums each line and keeps total = subtotal - discount + tax', () => {
    const totals = invoiceTotals([
      {
        quantityMilli: 1_500,
        unitPriceMinor: 8_000n,
        discountMinor: 0n,
        taxRateBps: 2_000,
      },
      {
        quantityMilli: 1_000,
        unitPriceMinor: 2_500n,
        discountMinor: 500n,
        taxRateBps: 2_000,
      },
    ]);

    expect(totals).toEqual({
      subtotalMinor: 14_500n,
      discountMinor: 500n,
      taxMinor: 2_800n,
      totalMinor: 16_800n,
    });
    expect(totals.totalMinor).toBe(totals.subtotalMinor - totals.discountMinor + totals.taxMinor);
  });

  it('returns zeroes for an empty invoice', () => {
    expect(invoiceTotals([])).toEqual({
      subtotalMinor: 0n,
      discountMinor: 0n,
      taxMinor: 0n,
      totalMinor: 0n,
    });
  });
});
