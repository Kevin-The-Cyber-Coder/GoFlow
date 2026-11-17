import { formatMinor } from '@goflow/shared';

/**
 * Formats an API money string (integer minor units) for display.
 *
 * The API transports money as strings so large values never pass through a
 * JavaScript number. The shared formatter does the same on both sides of the
 * wire; a malformed value falls back to the raw amount rather than throwing
 * inside a render.
 */
export function formatMoney(
  minor: string | null | undefined,
  currency: string,
  locale?: string,
): string {
  if (minor === null || minor === undefined || minor === '') return '—';

  try {
    return formatMinor(BigInt(minor), currency, locale);
  } catch {
    return `${minor} ${currency}`;
  }
}

/** A date-only API value, formatted without shifting across time zones. */
export function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/** Turns a role code such as PARTIALLY_PAID into a readable label. */
export function humanise(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((part) => (part.length === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(' ');
}
