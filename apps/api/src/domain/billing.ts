/**
 * Billing arithmetic shared by every module that turns time into money.
 *
 * Rates are stored per hour and time per minute, so a value is
 * `minutes × rate / 60`. Summing the products before dividing (and rounding
 * half-up once) keeps per-entry truncation from quietly under-billing a
 * long project.
 */
export interface BillableEntry {
  readonly minutes: number;
  readonly billable: boolean;
  readonly hourlyRateMinor: bigint | null;
}

export function billableValueMinor(entries: readonly BillableEntry[]): bigint {
  let product = 0n;
  for (const entry of entries) {
    if (entry.billable && entry.hourlyRateMinor !== null) {
      product += BigInt(entry.minutes) * entry.hourlyRateMinor;
    }
  }
  return product === 0n ? 0n : (product + 30n) / 60n;
}
