import { z } from 'zod';

const CURRENCY_CODES = Intl.supportedValuesOf('currency');

/**
 * Validates a currency the same way `Intl.NumberFormat` will later use it, so
 * a code that is accepted here can always be formatted for display.
 */
const currency = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter ISO 4217 code.')
  .refine((value) => CURRENCY_CODES.includes(value), 'That currency code is not recognised.');

const locale = z
  .string()
  .trim()
  .max(35)
  .refine((value) => {
    try {
      Intl.getCanonicalLocales(value);
      return true;
    } catch {
      return false;
    }
  }, 'That language tag is not recognised.');

const timezone = z
  .string()
  .trim()
  .max(64)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'That time zone is not recognised.');

const avatarUrl = z.string().url('Enter a valid URL.').max(2048);

/**
 * Profile edits are deliberately narrow. E-mail, password, status and role are
 * not writable here: changing them is either a separate, verified workflow
 * (password, e-mail verification) or an administrative action. `.strict()`
 * turns an attempt to set them into a validation error instead of silently
 * ignoring the field.
 */
export const updateProfileSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required.').max(120).optional(),
    avatarUrl: avatarUrl.nullable().optional(),
    locale: locale.optional(),
    timezone: timezone.optional(),
    currency: currency.optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, { message: 'Provide at least one field.' });

export const closeAccountSchema = z
  .object({
    password: z.string().min(1, 'Confirm with your password.'),
  })
  .strict();

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type CloseAccountInput = z.infer<typeof closeAccountSchema>;
