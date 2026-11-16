import { z } from 'zod';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the YYYY-MM-DD format.')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'That date does not exist.');

const currency = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter ISO 4217 code.');

/**
 * Reports are always bounded. An unbounded range would scan every payment and
 * expense in the workspace, which is the one query a report screen must not
 * issue.
 */
export const reportSummarySchema = z
  .object({
    from: isoDate,
    to: isoDate,
    /** Defaults to the workspace currency. Amounts in other currencies are excluded. */
    currency: currency.optional(),
  })
  .refine((input) => input.from <= input.to, {
    message: 'The start date must be before the end date.',
    path: ['from'],
  })
  .refine(
    (input) =>
      (Date.parse(`${input.to}T00:00:00Z`) - Date.parse(`${input.from}T00:00:00Z`)) / 86_400_000 <=
      366,
    { message: 'Query at most one year at a time.', path: ['to'] },
  );

export type ReportSummaryQuery = z.infer<typeof reportSummarySchema>;
