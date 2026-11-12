/**
 * Money handling primitives.
 *
 * All monetary amounts are represented as integers in the currency's minor
 * unit (cents for USD/EUR, yen for JPY, fils for KWD). Floating point numbers
 * are never used to store, transport or compute money.
 *
 * These helpers are shared by the API and the web app so that both sides agree
 * on parsing and formatting rules. The API remains the only authority for
 * persisted financial values.
 */

export type MinorUnits = bigint;

const ISO_4217_SHAPE = /^[A-Z]{3}$/;

/**
 * Currencies whose minor unit is not the usual 1/100.
 *
 * Everything omitted here defaults to exponent 2. Keeping the list explicit
 * means an unknown currency is treated conservatively instead of silently
 * gaining a wrong number of decimals.
 */
const CURRENCY_EXPONENTS: Readonly<Record<string, number>> = {
  BHD: 3,
  BIF: 0,
  CLP: 0,
  DJF: 0,
  GNF: 0,
  IQD: 3,
  ISK: 0,
  JOD: 3,
  JPY: 0,
  KMF: 0,
  KRW: 0,
  KWD: 3,
  LYD: 3,
  OMR: 3,
  PYG: 0,
  RWF: 0,
  TND: 3,
  UGX: 0,
  UYI: 0,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0,
};

const DEFAULT_EXPONENT = 2;

export class MoneyFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyFormatError';
  }
}

export function assertCurrencyCode(currency: string): string {
  if (!ISO_4217_SHAPE.test(currency)) {
    throw new MoneyFormatError(
      `Invalid currency code "${currency}": expected a 3-letter ISO 4217 code.`,
    );
  }
  return currency;
}

export function currencyExponent(currency: string): number {
  assertCurrencyCode(currency);
  return CURRENCY_EXPONENTS[currency] ?? DEFAULT_EXPONENT;
}

/**
 * Parses a human-entered decimal string into minor units.
 *
 * Accepted: "1000", "1000.5", "1000.50", "-12.30".
 * Rejected: thousands separators, currency symbols, exponent notation, and
 * more fractional digits than the currency supports (we refuse to round money
 * that the user typed, because that would silently change the amount).
 */
export function parseAmountToMinor(input: string, currency: string): MinorUnits {
  const exponent = currencyExponent(currency);
  const value = input.trim();

  if (value.length === 0) {
    throw new MoneyFormatError('Amount must not be empty.');
  }

  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) {
    throw new MoneyFormatError(
      `Invalid amount "${input}": expected digits with an optional decimal point.`,
    );
  }

  const [, sign, wholePart, fractionPart = ''] = match;
  if (wholePart === undefined) {
    throw new MoneyFormatError(`Invalid amount "${input}".`);
  }

  if (fractionPart.length > exponent) {
    throw new MoneyFormatError(
      `Invalid amount "${input}": ${currency} supports at most ${exponent} decimal places.`,
    );
  }

  const paddedFraction = fractionPart.padEnd(exponent, '0');
  const digits = `${wholePart}${paddedFraction}`;
  const minor = BigInt(digits);

  return sign === '-' ? -minor : minor;
}

/**
 * Formats minor units for display using the runtime's currency data.
 *
 * The integer part is formatted by `Intl` from a BigInt and the fractional
 * digits are spliced in from our own exact representation, so no value ever
 * passes through a floating point number.
 */
export function formatMinor(minor: MinorUnits, currency: string, locale = 'en-US'): string {
  const exponent = currencyExponent(currency);
  const factor = 10n ** BigInt(exponent);
  const absolute = minor < 0n ? -minor : minor;
  const whole = minor < 0n ? -(absolute / factor) : absolute / factor;
  const fraction = absolute % factor;

  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  });

  const fractionText = fraction.toString().padStart(exponent, '0');

  return formatter
    .formatToParts(whole)
    .map((part) => (part.type === 'fraction' ? fractionText : part.value))
    .join('');
}

export function sumMinor(values: readonly MinorUnits[]): MinorUnits {
  return values.reduce<MinorUnits>((total, value) => total + value, 0n);
}
