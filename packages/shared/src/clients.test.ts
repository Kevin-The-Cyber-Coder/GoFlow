import { describe, expect, it } from '@jest/globals';

import { clientListQuerySchema, createClientSchema, updateClientSchema } from './clients';

describe('createClientSchema', () => {
  it('normalises optional text, email and country', () => {
    const parsed = createClientSchema.parse({
      name: '  Acme Studio  ',
      email: '  Billing@Acme.Example ',
      phone: '',
      country: 'gb',
    });

    expect(parsed).toEqual({
      name: 'Acme Studio',
      email: 'billing@acme.example',
      phone: null,
      company: null,
      taxId: null,
      addressLine1: null,
      addressLine2: null,
      city: null,
      postalCode: null,
      country: 'GB',
      notes: null,
    });
  });

  it('rejects an invalid email', () => {
    const result = createClientSchema.safeParse({ name: 'Acme', email: 'not-an-email' });

    expect(result.success).toBe(false);
  });

  it('rejects a country that is not a two-letter code', () => {
    const result = createClientSchema.safeParse({ name: 'Acme', country: 'GBR' });

    expect(result.success).toBe(false);
  });

  it('rejects unknown fields', () => {
    const result = createClientSchema.safeParse({ name: 'Acme', role: 'admin' });

    expect(result.success).toBe(false);
  });

  it('accepts an explicit null to clear a value', () => {
    expect(createClientSchema.parse({ name: 'Acme', email: null }).email).toBeNull();
  });
});

describe('updateClientSchema', () => {
  it('accepts a partial update', () => {
    expect(updateClientSchema.parse({ company: 'Acme Holdings' })).toEqual({
      company: 'Acme Holdings',
    });
  });

  it('rejects an empty update', () => {
    expect(updateClientSchema.safeParse({}).success).toBe(false);
  });

  it('does not allow clearing the required name', () => {
    expect(updateClientSchema.safeParse({ name: null }).success).toBe(false);
  });
});

describe('clientListQuerySchema', () => {
  it('applies defaults and coerces numbers', () => {
    expect(clientListQuerySchema.parse({})).toEqual({
      includeArchived: false,
      limit: 25,
      offset: 0,
    });
    expect(clientListQuerySchema.parse({ limit: '10', offset: '5' })).toMatchObject({
      limit: 10,
      offset: 5,
    });
  });

  it('rejects an out-of-range limit', () => {
    expect(clientListQuerySchema.safeParse({ limit: '500' }).success).toBe(false);
  });

  it('rejects unknown query parameters', () => {
    expect(clientListQuerySchema.safeParse({ sort: 'name' }).success).toBe(false);
  });
});
