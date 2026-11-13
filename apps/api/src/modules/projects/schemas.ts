import { z } from 'zod';

import { paginationSchema } from '../../http/pagination';

const projectStatus = z.enum(['PLANNING', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED']);
const projectPriority = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);

const optionalText = (max: number) => z.string().trim().max(max).optional();

/**
 * Calendar dates are exchanged as `YYYY-MM-DD` strings and stored at UTC
 * midnight. Building the date from parts (and round-tripping it) rejects
 * `2026-02-31`, which `Date.parse` would silently roll over into March.
 */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the YYYY-MM-DD format.')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'That date does not exist.');

/** Money crosses the wire as a decimal string of minor units. */
const minorUnits = z
  .string()
  .trim()
  .regex(/^\d{1,15}$/, 'Amount must be a non-negative integer in minor units.');

const currency = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter ISO 4217 code.');

export const createProjectSchema = z
  .object({
    clientId: z.string().uuid('Choose a client.'),
    name: z.string().trim().min(1, 'Project name is required.').max(200),
    description: optionalText(5_000),
    status: projectStatus.optional(),
    priority: projectPriority.optional(),
    startDate: isoDate.optional(),
    dueDate: isoDate.optional(),
    budgetMinor: minorUnits.optional(),
    currency: currency.optional(),
  })
  .refine(
    (input) =>
      input.startDate === undefined ||
      input.dueDate === undefined ||
      input.dueDate >= input.startDate,
    { message: 'The due date cannot be before the start date.', path: ['dueDate'] },
  );

export const updateProjectSchema = z
  .object({
    clientId: z.string().uuid('Choose a client.').optional(),
    name: z.string().trim().min(1, 'Project name is required.').max(200).optional(),
    description: z.string().trim().max(5_000).nullable().optional(),
    status: projectStatus.optional(),
    priority: projectPriority.optional(),
    startDate: isoDate.nullable().optional(),
    dueDate: isoDate.nullable().optional(),
    budgetMinor: minorUnits.nullable().optional(),
    currency: currency.optional(),
  })
  .refine((input) => Object.keys(input).length > 0, { message: 'Provide at least one field.' });

export const listProjectsSchema = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  status: projectStatus.optional(),
  clientId: z.string().uuid().optional(),
  includeArchived: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  sort: z.enum(['name', 'createdAt', 'dueDate', 'status']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type ListProjectsQuery = z.infer<typeof listProjectsSchema>;
