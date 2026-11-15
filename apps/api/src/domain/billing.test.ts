import { describe, expect, it } from '@jest/globals';

import { billableValueMinor } from './billing';

describe('billableValueMinor', () => {
  it('converts an hourly rate to the minutes worked', () => {
    expect(billableValueMinor([{ minutes: 90, billable: true, hourlyRateMinor: 60_000n }])).toBe(
      90_000n,
    );
  });

  it('rounds half-up to the nearest minor unit', () => {
    // 1 minute at 1.00/hour = 1.666… cents, which rounds to 2.
    expect(billableValueMinor([{ minutes: 1, billable: true, hourlyRateMinor: 100n }])).toBe(2n);
  });

  it('rounds once across the total instead of per entry', () => {
    const perEntry = 2n + 2n;
    const combined = billableValueMinor([
      { minutes: 1, billable: true, hourlyRateMinor: 100n },
      { minutes: 1, billable: true, hourlyRateMinor: 100n },
    ]);
    expect(combined).toBe(3n);
    expect(combined).not.toBe(perEntry);
  });

  it('ignores non-billable entries and entries without a rate', () => {
    expect(
      billableValueMinor([
        { minutes: 120, billable: false, hourlyRateMinor: 60_000n },
        { minutes: 120, billable: true, hourlyRateMinor: null },
      ]),
    ).toBe(0n);
  });
});
