import { z } from 'zod';

import { lineGrossMinor } from '../../domain/invoice';
import { paginationSchema } from '../../http/pagination';

const INVOICE_STATUSES = [
  'DRAFT',
  'SENT',
  'PARTIALLY_PAID',
  'PAID',
  'OVERDUE',
  'CANCELLED',
  'VOID',
] as const;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the YYYY-MM-DD format.')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'That date does not exist.');

const minorUnits = z
  .string()
  .trim()
  .regex(/^\d{1,15}$/, 'Amount must be a non-negative integer in minor units.');

const currency = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter ISO 4217 code.');

const optionalText = (max: number) => z.string().trim().max(max).optional();

const lineItem = z.object({
  description: z.string().trim().min(1, 'Describe the line item.').max(500),
  /** Thousandths of a unit, so 1.5 hours is 1500. */
  quantityMilli: z
    .number()
    .int('Quantity must be a whole number of thousandths.')
    .min(1, 'Quantity must be positive.')
    .max(100_000_000, 'Quantity is too large.'),
  unitPriceMinor: minorUnits,
  discountMinor: minorUnits.optional(),
  /** Basis points, so 19% VAT is 1900. */
  taxRateBps: z.number().int().min(0).max(10_000).optional(),
});

function normaliseLine(item: LineItemInput) {
  return {
    description: item.description,
    quantityMilli: item.quantityMilli,
    unitPriceMinor: BigInt(item.unitPriceMinor),
    discountMinor: item.discountMinor === undefined ? 0n : BigInt(item.discountMinor),
    taxRateBps: item.taxRateBps ?? 0,
  };
}

/**
 * A discount is absolute money, so its ceiling depends on quantity x price.
 * This is the one validation that cannot live in the field schema itself; it
 * also catches the common typo of putting the discount in the price field.
 */
function refineLineItems(items: readonly LineItemInput[], ctx: z.RefinementCtx): void {
  items.forEach((item, index) => {
    const line = normaliseLine(item);
    const gross = lineGrossMinor(line.quantityMilli, line.unitPriceMinor);
    if (line.discountMinor > gross) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, 'discountMinor'],
        message: 'The discount cannot exceed the line subtotal.',
      });
    }
  });
}

export const createInvoiceSchema = z
  .object({
    clientId: z.string().uuid('Choose a client.'),
    projectId: z.string().uuid('Choose a valid project.').optional(),
    issueDate: isoDate,
    dueDate: isoDate,
    currency: currency.optional(),
    notes: optionalText(5_000),
    terms: optionalText(5_000),
    template: z.string().trim().min(1).max(50).optional(),
    items: z.array(lineItem).min(1, 'Add at least one line item.').max(100),
  })
  .superRefine((input, ctx) => {
    if (input.dueDate < input.issueDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dueDate'],
        message: 'The due date cannot be before the issue date.',
      });
    }
    refineLineItems(input.items, ctx);
  });

export const updateInvoiceSchema = z
  .object({
    clientId: z.string().uuid('Choose a client.').optional(),
    projectId: z.string().uuid('Choose a valid project.').nullable().optional(),
    issueDate: isoDate.optional(),
    dueDate: isoDate.optional(),
    currency: currency.optional(),
    notes: z.string().trim().max(5_000).nullable().optional(),
    terms: z.string().trim().max(5_000).nullable().optional(),
    template: z.string().trim().min(1).max(50).optional(),
    items: z.array(lineItem).min(1, 'Add at least one line item.').max(100).optional(),
  })
  .superRefine((input, ctx) => {
    const keys = Object.keys(input);
    if (keys.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: 'Provide at least one field.',
      });
      return;
    }
    if (input.issueDate !== undefined && input.dueDate !== undefined) {
      if (input.dueDate < input.issueDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['dueDate'],
          message: 'The due date cannot be before the issue date.',
        });
      }
    }
    if (input.items !== undefined) {
      refineLineItems(input.items, ctx);
    }
  });

export const listInvoicesSchema = paginationSchema.extend({
  status: z.enum(INVOICE_STATUSES).optional(),
  clientId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  search: z.string().trim().max(100).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  sort: z.enum(['issueDate', 'dueDate', 'number', 'createdAt']).default('issueDate'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export type LineItemInput = z.infer<typeof lineItem>;
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type UpdateInvoiceInput = z.infer<typeof updateInvoiceSchema>;
export type ListInvoicesQuery = z.infer<typeof listInvoicesSchema>;

/** Converts a validated line into the shape the domain layer expects. */
export function toLineInput(item: LineItemInput) {
  return normaliseLine(item);
}
