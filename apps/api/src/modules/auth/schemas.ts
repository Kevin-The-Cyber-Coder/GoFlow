import { z } from 'zod';

import { MAX_PASSWORD_BYTES } from './password';

const email = z.string().trim().toLowerCase().email('Enter a valid e-mail address.').max(254);

/**
 * Password policy: at least 10 characters, at most 72 bytes (bcrypt's limit),
 * with at least one letter and one digit. Length is the dominant factor, but
 * requiring both classes blocks the most trivial dictionaries.
 */
const password = z
  .string()
  .min(10, 'Password must be at least 10 characters.')
  .refine((value) => Buffer.byteLength(value, 'utf8') <= MAX_PASSWORD_BYTES, {
    message: `Password must not exceed ${MAX_PASSWORD_BYTES} bytes.`,
  })
  .refine((value) => /[A-Za-z]/.test(value) && /\d/.test(value), {
    message: 'Password must contain at least one letter and one digit.',
  });

export const registerSchema = z.object({
  email,
  password,
  name: z.string().trim().min(1, 'Name is required.').max(120),
  businessName: z.string().trim().min(1).max(120).optional(),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter ISO 4217 code.')
    .optional(),
  timezone: z.string().trim().max(64).optional(),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Password is required.'),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(20, 'A refresh token is required.'),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required.'),
  newPassword: password,
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
