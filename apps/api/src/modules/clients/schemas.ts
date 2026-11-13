import { z } from 'zod';

import { paginationSchema } from '../../http/pagination';

const clientStatus = z.enum(['LEAD', 'ACTIVE', 'INACTIVE', 'ARCHIVED']);

const optionalText = (max: number) => z.string().trim().max(max).optional();

const email = z.string().trim().toLowerCase().email('Enter a valid e-mail address.').max(254);

export const createClientSchema = z.object({
  name: z.string().trim().min(1, 'Client name is required.').max(200),
  company: optionalText(200),
  email: email.optional(),
  phone: optionalText(40),
  billingLine1: optionalText(200),
  billingLine2: optionalText(200),
  billingCity: optionalText(120),
  billingPostal: optionalText(30),
  billingCountry: optionalText(2),
  category: optionalText(60),
  status: clientStatus.optional(),
  notes: z.string().trim().max(5000).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});

export const updateClientSchema = createClientSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'Provide at least one field.' });

export const listClientsSchema = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  status: clientStatus.optional(),
  category: z.string().trim().max(60).optional(),
  includeArchived: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  sort: z.enum(['name', 'createdAt', 'updatedAt']).default('name'),
  order: z.enum(['asc', 'desc']).default('asc'),
});

export const contactSchema = z.object({
  name: z.string().trim().min(1, 'Contact name is required.').max(120),
  email: email.optional(),
  phone: optionalText(40),
  title: optionalText(120),
  isPrimary: z.boolean().optional(),
});

export const updateContactSchema = contactSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'Provide at least one field.' });

export const importClientsSchema = z.object({
  csv: z.string().min(1, 'Provide the CSV contents.').max(2_000_000, 'The file is too large.'),
  dryRun: z.boolean().default(false),
});

export type ImportClientsInput = z.infer<typeof importClientsSchema>;
export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
export type ListClientsQuery = z.infer<typeof listClientsSchema>;
