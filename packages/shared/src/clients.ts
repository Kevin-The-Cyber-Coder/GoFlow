import { z } from 'zod';

/**
 * Client (customer) contracts shared by the API and the web client.
 *
 * Optional text fields accept `null` so a PATCH can clear a value, and an empty
 * string is normalised to `null` rather than stored as a distinct empty value.
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be at most ${max} characters.`)
    .nullish()
    .transform((value) => (value ? value : null));

const optionalEmail = z
  .string()
  .trim()
  .max(254, 'Email is too long.')
  .nullish()
  .transform((value) => (value ? value.toLowerCase() : null))
  .refine(
    (value) => value === null || z.string().email().safeParse(value).success,
    'Enter a valid email address.',
  );

const optionalCountry = z
  .string()
  .trim()
  .toUpperCase()
  .nullish()
  .transform((value) => (value ? value : null))
  .refine(
    (value) => value === null || /^[A-Z]{2}$/.test(value),
    'Country must be a two-letter ISO 3166-1 code.',
  );

export const createClientSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required.').max(120, 'Name is too long.'),
    email: optionalEmail,
    phone: optionalText(40),
    company: optionalText(160),
    taxId: optionalText(60),
    addressLine1: optionalText(160),
    addressLine2: optionalText(160),
    city: optionalText(80),
    postalCode: optionalText(20),
    country: optionalCountry,
    notes: optionalText(5_000),
  })
  .strict();

export const updateClientSchema = createClientSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update.',
  });

export const clientListQuerySchema = z
  .object({
    search: z.string().trim().max(120).optional(),
    includeArchived: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => value === 'true'),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export interface Client {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  taxId: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  postalCode: string | null;
  country: string | null;
  notes: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
export type ClientListQuery = z.infer<typeof clientListQuerySchema>;
