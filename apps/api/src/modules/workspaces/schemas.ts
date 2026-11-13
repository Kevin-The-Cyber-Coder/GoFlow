import { z } from 'zod';

const currency = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter ISO 4217 code.');

const role = z.enum(['ADMIN', 'ACCOUNTANT', 'PROJECT_MANAGER', 'EMPLOYEE', 'VIEWER'], {
  errorMap: () => ({ message: 'Choose a valid team role.' }),
});

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(120),
  currency: currency.optional(),
  timezone: z.string().trim().max(64).optional(),
});

export const updateWorkspaceSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    currency: currency.optional(),
    timezone: z.string().trim().max(64).optional(),
    invoicePrefix: z
      .string()
      .trim()
      .regex(
        /^[A-Z0-9-]{1,12}$/,
        'Invoice prefix must be 1-12 uppercase letters, digits or dashes.',
      )
      .optional(),
    defaultTaxRateBps: z.number().int().min(0).max(10_000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Provide at least one field.' });

export const inviteMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid e-mail address.'),
  role,
});

export const updateMemberSchema = z.object({ role });

export const transferOwnershipSchema = z.object({
  userId: z.string().uuid('Choose a valid member.'),
});

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>;
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
