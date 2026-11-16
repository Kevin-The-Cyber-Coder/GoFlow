import { z } from 'zod';

import { paginationSchema } from '../../http/pagination';

const EXPENSE_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'] as const;
const REVIEW_STATUSES = ['APPROVED', 'REJECTED'] as const;
const PAYMENT_METHODS = ['BANK_TRANSFER', 'CASH', 'MOBILE_MONEY', 'CARD', 'OTHER'] as const;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the YYYY-MM-DD format.')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'That date does not exist.');

/** Expenses are positive amounts; a refund is a separate, negated correction. */
const amountMinor = z
  .string()
  .trim()
  .regex(/^[1-9]\d{0,14}$/, 'Enter a positive amount in minor units, for example "4599".');

const currency = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter ISO 4217 code.');

const optionalText = (max: number) => z.string().trim().max(max).optional();
const nullableText = (max: number) => z.string().trim().max(max).nullable().optional();

const expenseFields = {
  description: z.string().trim().min(1, 'Describe the expense.').max(200),
  amountMinor,
  currency: currency.optional(),
  date: isoDate,
  method: z.enum(PAYMENT_METHODS).optional(),
  vendor: optionalText(160),
  notes: optionalText(2_000),
  categoryId: z.string().uuid('Choose a category.').nullable().optional(),
  projectId: z.string().uuid('Choose a valid project.').nullable().optional(),
  clientId: z.string().uuid('Choose a valid client.').nullable().optional(),
  recurring: z.boolean().optional(),
};

export const createExpenseSchema = z.object({
  ...expenseFields,
  /**
   * Only a caller with `expenses:approve` may create an already-approved
   * expense; everyone else starts at SUBMITTED and waits for review.
   */
  status: z.enum([...EXPENSE_STATUSES]).optional(),
});

export const updateExpenseSchema = z
  .object({
    description: expenseFields.description.optional(),
    amountMinor: amountMinor.optional(),
    currency: currency.optional(),
    date: isoDate.optional(),
    method: z.enum(PAYMENT_METHODS).optional(),
    vendor: nullableText(160),
    notes: nullableText(2_000),
    categoryId: expenseFields.categoryId,
    projectId: expenseFields.projectId,
    clientId: expenseFields.clientId,
    recurring: z.boolean().optional(),
  })
  .refine((input) => Object.keys(input).length > 0, { message: 'Provide at least one field.' });

export const listExpensesSchema = paginationSchema.extend({
  from: isoDate.optional(),
  to: isoDate.optional(),
  categoryId: z.string().uuid('Use a valid category id.').optional(),
  projectId: z.string().uuid('Use a valid project id.').optional(),
  clientId: z.string().uuid('Use a valid client id.').optional(),
  status: z.enum([...EXPENSE_STATUSES]).optional(),
  /** Matches the description or the vendor, case-insensitively. */
  search: z.string().trim().min(1).max(100).optional(),
});

export const reviewExpenseSchema = z.object({
  status: z.enum([...REVIEW_STATUSES], { message: 'Review an expense as APPROVED or REJECTED.' }),
  note: z.string().trim().max(500).optional(),
});

export const createCategorySchema = z.object({
  name: z.string().trim().min(1, 'Name the category.').max(60),
  /** Six-digit hex colour used by the web client. */
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use a six-digit hex colour such as "#64748b".')
    .optional(),
});

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;
export type ListExpensesQuery = z.infer<typeof listExpensesSchema>;
export type ReviewExpenseInput = z.infer<typeof reviewExpenseSchema>;
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
