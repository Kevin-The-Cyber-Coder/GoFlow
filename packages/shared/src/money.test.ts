import {
  MoneyFormatError,
  currencyExponent,
  formatMinor,
  parseAmountToMinor,
  sumMinor,
} from './money';

describe('currencyExponent', () => {
  it('defaults to 2 decimals for common currencies', () => {
    expect(currencyExponent('USD')).toBe(2);
    expect(currencyExponent('EUR')).toBe(2);
  });

  it('uses 0 decimals for zero-decimal currencies', () => {
    expect(currencyExponent('JPY')).toBe(0);
    expect(currencyExponent('KRW')).toBe(0);
  });

  it('uses 3 decimals for three-decimal currencies', () => {
    expect(currencyExponent('KWD')).toBe(3);
  });

  it('rejects malformed currency codes', () => {
    expect(() => currencyExponent('usd')).toThrow(MoneyFormatError);
    expect(() => currencyExponent('US')).toThrow(MoneyFormatError);
  });
});

describe('parseAmountToMinor', () => {
  it('parses whole amounts', () => {
    expect(parseAmountToMinor('1000', 'USD')).toBe(100_000n);
  });

  it('parses fractional amounts', () => {
    expect(parseAmountToMinor('1000.5', 'USD')).toBe(100_050n);
    expect(parseAmountToMinor('0.01', 'USD')).toBe(1n);
  });

  it('parses negative amounts', () => {
    expect(parseAmountToMinor('-12.30', 'USD')).toBe(-1_230n);
  });

  it('respects zero-decimal currencies', () => {
    expect(parseAmountToMinor('500', 'JPY')).toBe(500n);
    expect(() => parseAmountToMinor('500.5', 'JPY')).toThrow(MoneyFormatError);
  });

  it('respects three-decimal currencies', () => {
    expect(parseAmountToMinor('1.234', 'KWD')).toBe(1_234n);
  });

  it('rejects too many decimal places instead of rounding', () => {
    expect(() => parseAmountToMinor('10.005', 'USD')).toThrow(MoneyFormatError);
  });

  it('rejects thousands separators and symbols', () => {
    expect(() => parseAmountToMinor('1,000.00', 'USD')).toThrow(MoneyFormatError);
    expect(() => parseAmountToMinor('$10', 'USD')).toThrow(MoneyFormatError);
  });

  it('rejects exponent notation', () => {
    expect(() => parseAmountToMinor('1e3', 'USD')).toThrow(MoneyFormatError);
  });

  it('rejects empty and whitespace-only input', () => {
    expect(() => parseAmountToMinor('', 'USD')).toThrow(MoneyFormatError);
    expect(() => parseAmountToMinor('   ', 'USD')).toThrow(MoneyFormatError);
  });
});

describe('formatMinor', () => {
  it('formats two-decimal currencies', () => {
    expect(formatMinor(100_050n, 'USD')).toBe('$1,000.50');
  });

  it('formats negative amounts', () => {
    expect(formatMinor(-1_230n, 'USD')).toBe('-$12.30');
  });

  it('formats zero-decimal currencies', () => {
    expect(formatMinor(0n, 'JPY')).toBe('¥0');
    expect(formatMinor(1_500n, 'JPY')).toBe('¥1,500');
  });

  it('formats three-decimal currencies', () => {
    expect(formatMinor(1_234n, 'KWD')).toBe('KWD\xa01.234');
  });

  it('round-trips through parsing', () => {
    const minor = parseAmountToMinor('987654.32', 'USD');
    expect(minor).toBe(98_765_432n);
    expect(formatMinor(minor, 'USD')).toBe('$987,654.32');
  });

  it('does not lose precision for large balances', () => {
    const minor = 9_007_199_254_740_993n; // > Number.MAX_SAFE_INTEGER
    expect(formatMinor(minor, 'USD')).toBe('$90,071,992,547,409.93');
  });
});

describe('sumMinor', () => {
  it('sums values as integers', () => {
    expect(sumMinor([1n, 2n, 3n])).toBe(6n);
  });

  it('returns zero for an empty list', () => {
    expect(sumMinor([])).toBe(0n);
  });
});
