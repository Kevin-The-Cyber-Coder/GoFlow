import { z } from 'zod';

import { paginationSchema } from '../../http/pagination';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the YYYY-MM-DD format.')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'That date does not exist.');

/**
 * Audit queries are read-only and deliberately bounded: the log grows with
 * every write in the workspace, so callers page through it rather than asking
 * for "everything since the beginning".
 */
export const listAuditSchema = paginationSchema.extend({
  action: z.string().trim().min(1).max(80).optional(),
  entityType: z.string().trim().min(1).max(60).optional(),
  entityId: z.string().trim().min(1).max(64).optional(),
  actorId: z.string().uuid('Use a valid actor id.').optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  search: z.string().trim().min(1).max(100).optional(),
});

export type ListAuditQuery = z.infer<typeof listAuditSchema>;
