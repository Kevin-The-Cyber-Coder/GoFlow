import { describe, expect, it } from '@jest/globals';

import { createPaymentSchema } from './payments';

describe('createPaymentSchema', () => {
  it('applies the default method and normalises optional text', () => {
    const parsed = createPaymentSchema.parse({ amountMinor: 5_000, reference: '  ' });

    expect(parsed).toEqual({
      amountMinor: 5_000,
      method: 'bank_transfer',
      reference: null,
      paidAt: null,
      notes: null,
    });
  });

  it('rejects zero, negative and fractional amounts', () => {
    for (const amountMinor of [0, -1, 10.5]) {
      expect(createPaymentSchema.safeParse({ amountMinor }).success).toBe(false);
    }
  });

  it('rejects an unknown method', () => {
    expect(createPaymentSchema.safeParse({ amountMinor: 100, method: 'crypto' }).success).toBe(
      false,
    );
  });

  it('accepts an ISO timestamp with an offset', () => {
    const parsed = createPaymentSchema.parse({
      amountMinor: 100,
      paidAt: '2026-11-12T10:30:00.000Z',
    });

    expect(parsed.paidAt).toBe('2026-11-12T10:30:00.000Z');
  });

  it('rejects a date without a time', () => {
    expect(createPaymentSchema.safeParse({ amountMinor: 100, paidAt: '2026-11-12' }).success).toBe(
      false,
    );
  });

  it('rejects unknown fields', () => {
    expect(createPaymentSchema.safeParse({ amountMinor: 100, currency: 'USD' }).success).toBe(
      false,
    );
  });
});
