import { z } from 'zod';

import { paginationSchema } from '../../http/pagination';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the YYYY-MM-DD format.')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'That date does not exist.');

/** A positive integer amount in minor units, never a float and never a sign. */
const amountMinor = z
  .string()
  .regex(/^[1-9]\d{0,11}$/, 'Enter a positive amount in minor units, for example "25000".');

const paymentMethod = z.enum(['BANK_TRANSFER', 'CASH', 'MOBILE_MONEY', 'CARD', 'OTHER']);

const optionalText = (max: number) => z.string().trim().max(max).optional();

export const createPaymentSchema = z.object({
  invoiceId: z.string().uuid('Choose an invoice.'),
  amountMinor,
  method: paymentMethod.optional(),
  paidAt: isoDate.optional(),
  reference: optionalText(120),
  notes: optionalText(2_000),
  /**
   * Optional client-supplied key. A retried request with the same key returns
   * the payment that was already recorded instead of charging twice.
   */
  idempotencyKey: optionalText(100),
});

export const listPaymentsSchema = paginationSchema.extend({
  invoiceId: z.string().uuid('Use a valid invoice id.').optional(),
  kind: z.enum(['PAYMENT', 'REFUND']).optional(),
  status: z.enum(['COMPLETED', 'PENDING', 'FAILED', 'REVERSED']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export const reversePaymentSchema = z.object({
  reason: z.string().trim().min(1).max(500).optional(),
});

export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;
export type ListPaymentsQuery = z.infer<typeof listPaymentsSchema>;
export type ReversePaymentInput = z.infer<typeof reversePaymentSchema>;
