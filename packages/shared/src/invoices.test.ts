import { describe, expect, it } from '@jest/globals';

import { createInvoiceSchema, updateInvoiceSchema } from './invoices';
import { formatQuantityMilli, parseQuantityToMilli } from './quantity';

const validInvoice = {
  clientId: '00000000-0000-4000-8000-000000000000',
  issueDate: '2026-11-01',
  dueDate: '2026-11-30',
  items: [
    { description: 'Design work', quantity: '12.5', unitPriceMinor: 8_000, taxRateBps: 2_000 },
  ],
};

describe('quantity helpers', () => {
  it('parses up to three decimal places exactly', () => {
    expect(parseQuantityToMilli('1')).toBe(1_000);
    expect(parseQuantityToMilli('1.5')).toBe(1_500);
    expect(parseQuantityToMilli('0.001')).toBe(1);
    expect(parseQuantityToMilli(' 2.25 ')).toBe(2_250);
  });

  it('rejects malformed quantities', () => {
    for (const value of ['', '-1', '1.2345', '1e3', '.5', '1,000']) {
      expect(() => parseQuantityToMilli(value)).toThrow();
    }
  });

  it('formats without trailing zeros', () => {
    expect(formatQuantityMilli(1_000)).toBe('1');
    expect(formatQuantityMilli(1_500)).toBe('1.5');
    expect(formatQuantityMilli(1_001)).toBe('1.001');
    expect(formatQuantityMilli(0)).toBe('0');
  });
});

describe('createInvoiceSchema', () => {
  it('accepts a valid invoice with defaults', () => {
    const parsed = createInvoiceSchema.parse(validInvoice);

    expect(parsed).toMatchObject({
      discount: { type: 'none' },
      notes: null,
      terms: null,
    });
    expect(parsed.currency).toBeUndefined();
  });

  it('rejects a due date before the issue date', () => {
    const result = createInvoiceSchema.safeParse({ ...validInvoice, dueDate: '2026-10-01' });

    expect(result.success).toBe(false);
  });

  it('rejects an impossible calendar date', () => {
    expect(
      createInvoiceSchema.safeParse({ ...validInvoice, issueDate: '2026-02-30' }).success,
    ).toBe(false);
  });

  it('requires at least one line', () => {
    expect(createInvoiceSchema.safeParse({ ...validInvoice, items: [] }).success).toBe(false);
  });

  it('rejects a tax rate above 100%', () => {
    const result = createInvoiceSchema.safeParse({
      ...validInvoice,
      items: [{ ...validInvoice.items[0], taxRateBps: 10_001 }],
    });

    expect(result.success).toBe(false);
  });

  it('rejects a fractional minor-unit price', () => {
    const result = createInvoiceSchema.safeParse({
      ...validInvoice,
      items: [{ ...validInvoice.items[0], unitPriceMinor: 10.5 }],
    });

    expect(result.success).toBe(false);
  });
});

describe('updateInvoiceSchema', () => {
  it('accepts a partial update', () => {
    expect(updateInvoiceSchema.parse({ notes: 'Thank you' })).toEqual({ notes: 'Thank you' });
  });

  it('rejects an empty update', () => {
    expect(updateInvoiceSchema.safeParse({}).success).toBe(false);
  });

  it('rejects a due date before the issue date when both are given', () => {
    expect(
      updateInvoiceSchema.safeParse({ issueDate: '2026-11-10', dueDate: '2026-11-01' }).success,
    ).toBe(false);
  });
});
