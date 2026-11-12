/**
 * Quantities are integers in milli-units (1000 = one unit) for the same reason
 * money is: decimal arithmetic in JavaScript floats drifts. Users type "1.5"
 * and the API stores 1500.
 */

const QUANTITY_PATTERN = /^\d{1,9}(?:\.\d{1,3})?$/;

export class QuantityFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuantityFormatError';
  }
}

export function parseQuantityToMilli(input: string): number {
  const value = input.trim();

  if (!QUANTITY_PATTERN.test(value)) {
    throw new QuantityFormatError(
      `Invalid quantity "${input}": expected a positive number with at most 3 decimal places.`,
    );
  }

  const [whole = '0', fraction = ''] = value.split('.');
  const milli = Number(whole) * 1_000 + Number(fraction.padEnd(3, '0'));

  if (!Number.isSafeInteger(milli)) {
    throw new QuantityFormatError(`Quantity "${input}" is too large.`);
  }

  return milli;
}

/** Formats milli-units back into the shortest exact decimal string. */
export function formatQuantityMilli(milli: number): string {
  if (!Number.isSafeInteger(milli) || milli < 0) {
    throw new QuantityFormatError(`Invalid quantity in milli-units: ${milli}.`);
  }

  const whole = Math.floor(milli / 1_000);
  const fraction = milli % 1_000;

  if (fraction === 0) {
    return String(whole);
  }

  return `${whole}.${String(fraction).padStart(3, '0').replace(/0+$/, '')}`;
}
