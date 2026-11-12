import { z } from 'zod';

import { parseQuantityToMilli } from './quantity';

export const INVOICE_STATUSES = ['draft', 'sent', 'cancelled', 'void'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const PAYMENT_STATUSES = ['unpaid', 'partial', 'paid', 'overdue'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

const MAX_MINOR = Number.MAX_SAFE_INTEGER;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the YYYY-MM-DD format.')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
  }, 'Enter a real calendar date.');

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be at most ${max} characters.`)
    .nullish()
    .transform((value) => (value ? value : null));

export const invoiceItemSchema = z
  .object({
    description: z
      .string()
      .trim()
      .min(1, 'Description is required.')
      .max(300, 'Description is too long.'),
    quantity: z
      .string()
      .trim()
      .refine((value) => {
        try {
          parseQuantityToMilli(value);
          return true;
        } catch {
          return false;
        }
      }, 'Quantity must be a positive number with at most 3 decimal places.'),
    unitPriceMinor: z.number().int().min(0).max(MAX_MINOR),
    taxRateBps: z.number().int().min(0).max(10_000),
  })
  .strict();

export const invoiceDiscountSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }).strict(),
  z
    .object({ type: z.literal('fixed'), amountMinor: z.number().int().min(0).max(MAX_MINOR) })
    .strict(),
  z.object({ type: z.literal('percent'), rateBps: z.number().int().min(0).max(10_000) }).strict(),
]);

const invoiceFields = z
  .object({
    clientId: z.string().uuid('Select a client.'),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter ISO 4217 code.')
      .optional(),
    issueDate: isoDate,
    dueDate: isoDate,
    notes: optionalText(2_000),
    terms: optionalText(2_000),
    discount: invoiceDiscountSchema.optional(),
    items: z.array(invoiceItemSchema).min(1, 'Add at least one line item.').max(200),
  })
  .strict();

function dueAfterIssue(value: { issueDate?: string; dueDate?: string }): boolean {
  if (!value.issueDate || !value.dueDate) {
    return true;
  }

  return value.dueDate >= value.issueDate;
}

const dueDateMessage = {
  message: 'Due date must not be before the issue date.',
  path: ['dueDate'],
};

export const createInvoiceSchema = invoiceFields
  .refine(dueAfterIssue, dueDateMessage)
  .transform((value) => ({ ...value, discount: value.discount ?? { type: 'none' as const } }));

export const updateInvoiceSchema = invoiceFields
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update.',
  })
  .refine(dueAfterIssue, dueDateMessage);

export const invoiceListQuerySchema = z
  .object({
    status: z.enum(INVOICE_STATUSES).optional(),
    clientId: z.string().uuid().optional(),
    search: z.string().trim().max(120).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export interface InvoiceItem {
  id: string;
  description: string;
  quantity: string;
  unitPriceMinor: number;
  taxRateBps: number;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
}

export type InvoiceDiscountInput = z.infer<typeof invoiceDiscountSchema>;
export type InvoiceItemInput = z.infer<typeof invoiceItemSchema>;

export interface InvoiceSummary {
  id: string;
  number: string;
  status: InvoiceStatus;
  paymentStatus: PaymentStatus;
  clientId: string;
  clientName: string;
  currency: string;
  issueDate: string;
  dueDate: string;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  amountPaidMinor: number;
  balanceMinor: number;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Invoice extends InvoiceSummary {
  notes: string | null;
  terms: string | null;
  discount: InvoiceDiscountInput;
  cancelledAt: string | null;
  voidedAt: string | null;
  items: InvoiceItem[];
}

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type UpdateInvoiceInput = z.infer<typeof updateInvoiceSchema>;
export type InvoiceListQuery = z.infer<typeof invoiceListQuerySchema>;
