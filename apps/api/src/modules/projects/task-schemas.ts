import { z } from 'zod';

const taskStatus = z.enum(['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE']);

const optionalText = (max: number) => z.string().trim().max(max).optional();

/** Calendar date; see projects/schemas.ts for the round-trip rationale. */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the YYYY-MM-DD format.')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'That date does not exist.');

const estimateMinutes = z.number().int().min(1).max(600_000);

export const createTaskSchema = z.object({
  title: z.string().trim().min(1, 'Task title is required.').max(200),
  description: optionalText(5_000),
  status: taskStatus.optional(),
  dueDate: isoDate.optional(),
  estimateMinutes: estimateMinutes.optional(),
});

export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1, 'Task title is required.').max(200).optional(),
    description: z.string().trim().max(5_000).nullable().optional(),
    status: taskStatus.optional(),
    dueDate: isoDate.nullable().optional(),
    estimateMinutes: estimateMinutes.nullable().optional(),
  })
  .refine((input) => Object.keys(input).length > 0, { message: 'Provide at least one field.' });

export const listTasksSchema = z.object({
  status: taskStatus.optional(),
  search: z.string().trim().max(100).optional(),
});

/**
 * Reorder is expressed as the complete, ordered id list for one column. That
 * makes the operation idempotent and avoids clients sending fractional
 * positions or a hundred individual PATCH requests.
 */
export const reorderTasksSchema = z.object({
  status: taskStatus,
  orderedIds: z.array(z.string().uuid()).max(1_000),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type ListTasksQuery = z.infer<typeof listTasksSchema>;
export type ReorderTasksInput = z.infer<typeof reorderTasksSchema>;
