import { z } from 'zod';

import { paginationSchema } from '../../http/pagination';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the YYYY-MM-DD format.')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'That date does not exist.');

/** A single entry is capped at a day; longer work is split across entries. */
const minutes = z
  .number()
  .int('Minutes must be a whole number.')
  .min(1, 'Log at least one minute.')
  .max(1_440, 'A single entry cannot exceed 24 hours.');

const minorUnits = z
  .string()
  .trim()
  .regex(/^\d{1,15}$/, 'Rate must be a non-negative integer in minor units.');

export const createTimeEntrySchema = z.object({
  projectId: z.string().uuid('Choose a project.'),
  taskId: z.string().uuid('Choose a valid task.').optional(),
  minutes,
  date: isoDate,
  note: z.string().trim().max(1_000).optional(),
  billable: z.boolean().default(true),
  hourlyRateMinor: minorUnits.optional(),
});

export const updateTimeEntrySchema = z
  .object({
    projectId: z.string().uuid('Choose a project.').optional(),
    taskId: z.string().uuid('Choose a valid task.').nullable().optional(),
    minutes: minutes.optional(),
    date: isoDate.optional(),
    note: z.string().trim().max(1_000).nullable().optional(),
    billable: z.boolean().optional(),
    hourlyRateMinor: minorUnits.nullable().optional(),
  })
  .refine((input) => Object.keys(input).length > 0, { message: 'Provide at least one field.' });

export const listTimeEntriesSchema = paginationSchema.extend({
  from: isoDate.optional(),
  to: isoDate.optional(),
  projectId: z.string().uuid().optional(),
  taskId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  billable: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
});

export const timeSummarySchema = z
  .object({
    from: isoDate,
    to: isoDate,
    projectId: z.string().uuid().optional(),
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

export type CreateTimeEntryInput = z.infer<typeof createTimeEntrySchema>;
export type UpdateTimeEntryInput = z.infer<typeof updateTimeEntrySchema>;
export type ListTimeEntriesQuery = z.infer<typeof listTimeEntriesSchema>;
export type TimeSummaryQuery = z.infer<typeof timeSummarySchema>;
