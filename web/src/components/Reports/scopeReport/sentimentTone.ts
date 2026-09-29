import type { SentimentLabel } from '../../../types/domain/sentimentExamples';

/**
 * How each sentiment reads and is tinted in the sentiment examples
 * (docs/design-system.md: emerald positive, gray neutral, amber mixed, red
 * negative). The modal is explicitly themed chrome, so every tint carries
 * its dark variant.
 */
interface SentimentTone {
  readonly label: string;
  /** Classes of the sentiment pill. */
  readonly pill: string;
  /** Border classes of the quoted passage. */
  readonly quote: string;
}

export const SENTIMENT_TONES: Readonly<Record<SentimentLabel, SentimentTone>> = {
  positive: {
    label: 'Positive',
    pill: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    quote: 'border-emerald-300 dark:border-emerald-700',
  },
  neutral: {
    label: 'Neutral',
    pill: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
    quote: 'border-gray-300 dark:border-gray-600',
  },
  mixed: {
    label: 'Mixed',
    pill: 'bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    quote: 'border-amber-300 dark:border-amber-700',
  },
  negative: {
    label: 'Negative',
    pill: 'bg-red-50 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    quote: 'border-red-300 dark:border-red-700',
  },
};
