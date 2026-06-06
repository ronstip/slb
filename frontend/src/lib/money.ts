/** Helpers for the $-based prepaid wallet. Balances are stored as USD micros
 *  (1_000_000 micros = $1.00) so we never round through floats server-side. */

const MICROS_PER_USD = 1_000_000;

/** Format USD micros as a dollar string, e.g. 3_500_000 → "$3.50".
 *  Non-finite input (undefined/null/NaN - e.g. a field a stale backend didn't
 *  return) renders as "$0.00" rather than "$NaN" so a deploy skew never shows a
 *  broken KPI. */
export function formatUsdMicros(micros: number, fractionDigits = 2): string {
  const safe = Number.isFinite(micros) ? micros : 0;
  return `$${(safe / MICROS_PER_USD).toFixed(fractionDigits)}`;
}

/** Format cents as a dollar string, e.g. 2500 → "$25". Non-finite → "$0". */
export function formatUsdCents(cents: number): string {
  const dollars = (Number.isFinite(cents) ? cents : 0) / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}
