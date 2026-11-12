import { z } from 'zod';

import type { InvoiceSummary } from './invoices';

export const PAYMENT_METHODS = ['bank_transfer', 'card', 'cash', 'paypal', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

const MAX_MINOR = Number.MAX_SAFE_INTEGER;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be at most ${max} characters.`)
    .nullish()
    .transform((value) => (value ? value : null));

const paidAtSchema = z
  .string()
  .datetime({ offset: true, message: 'Use an ISO 8601 timestamp.' })
  .nullish()
  .transform((value) => value ?? null);

/**
 * A payment is always attached to one invoice and recorded in the invoice's
 * currency. The amount is a positive integer in minor units, so a payment can
 * never carry fractional cents.
 */
export const createPaymentSchema = z
  .object({
    amountMinor: z
      .number()
      .int()
      .positive('Payment amount must be greater than zero.')
      .max(MAX_MINOR),
    method: z.enum(PAYMENT_METHODS).default('bank_transfer'),
    reference: optionalText(120),
    paidAt: paidAtSchema,
    notes: optionalText(1_000),
  })
  .strict();

export interface Payment {
  id: string;
  invoiceId: string;
  amountMinor: number;
  currency: string;
  method: PaymentMethod;
  reference: string | null;
  paidAt: string;
  notes: string | null;
  createdAt: string;
}

export interface CreatePaymentResult {
  payment: Payment;
  invoice: InvoiceSummary;
}

export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;
