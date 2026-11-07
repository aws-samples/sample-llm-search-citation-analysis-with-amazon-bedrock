/**
 * How tables and stat tiles word their numbers: thousands separators, a
 * compact form (`12.3M`) for large figures, and a dash for every unknown
 * value (never 0: an unknown figure is not a zero).
 */
export const UNKNOWN_VALUE = '—';

/** From this value on, `compactText` and `compactUsdText` abbreviate. */
const COMPACT_FROM = 10_000;

const INTEGER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const COMPACT = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});
const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});
const COMPACT_USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
});

type Figure = number | null | undefined;

function known(value: Figure): value is number {
  return value !== null && value !== undefined && Number.isFinite(value);
}

/** `1234567.4` → `1,234,567`. */
export function integerText(value: Figure): string {
  return known(value) ? INTEGER.format(value) : UNKNOWN_VALUE;
}

/** `1234567` → `1.2M`; values under 10,000 keep every digit (`9,876`). */
export function compactText(value: Figure): string {
  if (!known(value)) return UNKNOWN_VALUE;
  return Math.abs(value) < COMPACT_FROM ? INTEGER.format(value) : COMPACT.format(value);
}

/** `1234.5` → `$1,234.5`. */
export function usdText(value: Figure): string {
  return known(value) ? USD.format(value) : UNKNOWN_VALUE;
}

/** `12345678` → `$12.3M`; amounts under $10,000 stay exact. */
export function compactUsdText(value: Figure): string {
  if (!known(value)) return UNKNOWN_VALUE;
  return Math.abs(value) < COMPACT_FROM ? USD.format(value) : COMPACT_USD.format(value);
}

/** `12345.678` with 1 digit → `12,345.7`; always exactly `digits` decimals. */
export function decimalText(value: Figure, digits = 1): string {
  if (!known(value)) return UNKNOWN_VALUE;
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}
