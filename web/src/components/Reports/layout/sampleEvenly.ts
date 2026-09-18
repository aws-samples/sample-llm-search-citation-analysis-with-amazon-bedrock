/**
 * Picks at most `max` evenly spaced items, always keeping the first and the
 * last. Report tables use it to fit a 30-day history on one printed page
 * without losing the endpoints of the curve.
 */
export function sampleEvenly<T>(items: ReadonlyArray<T>, max: number): T[] {
  if (items.length <= max) return [...items];
  const step = (items.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => items[Math.round(i * step)]);
}
