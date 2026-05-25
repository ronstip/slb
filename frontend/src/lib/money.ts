/** Helpers for the $-based prepaid wallet. Balances are stored as USD micros
 *  (1_000_000 micros = $1.00) so we never round through floats server-side. */

const MICROS_PER_USD = 1_000_000;

/** Format USD micros as a dollar string, e.g. 3_500_000 → "$3.50". */
export function formatUsdMicros(micros: number, fractionDigits = 2): string {
  return `$${(micros / MICROS_PER_USD).toFixed(fractionDigits)}`;
}

/** Format cents as a dollar string, e.g. 2500 → "$25". */
export function formatUsdCents(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}
