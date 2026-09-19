/**
 * Semantic colour accent shared by the report primitives. "positive" is
 * used for wins / improvements, "negative" for losses / declines, and
 * "neutral" for plain figures that carry no directional meaning.
 */
export type ReportAccent = 'positive' | 'negative' | 'neutral';

/**
 * Tailwind text-colour classes for an accent, tuned so the same value reads
 * correctly on screen (light + dark) and on paper.
 */
export function accentTextClass(accent: ReportAccent): string {
  if (accent === 'positive') return 'text-emerald-700 dark:text-emerald-400';
  if (accent === 'negative') return 'text-red-700 dark:text-red-400';
  return 'text-gray-900 dark:text-white';
}
