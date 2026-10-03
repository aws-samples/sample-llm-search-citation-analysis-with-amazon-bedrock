import type { ChartConfiguration } from 'chart.js';
import type { SentimentSplit } from '../../../types/domain/groupKpiHistory';
import {
  themedAxis, type ChartTheme
} from '../../ui/chartTheme';
import {
  AMBER, EMERALD, GRAY, RED, type ThemedColour
} from './chartPalette';
import {
  barChartConfiguration, chartOptions, percentAxis
} from './chartOptions';
import type { ChartSeries } from './chartSeries';

export type Sentiment = keyof SentimentSplit;

/** A labelled sentiment split: a brand, a keyword, an engine. */
export interface SentimentRow {
  readonly label: string;
  readonly split: SentimentSplit;
}

/** The stacked segments, left to right. */
export const SENTIMENTS: ReadonlyArray<{
  readonly key: Sentiment;
  readonly label: string;
  readonly colour: ThemedColour;
}> = [
  {
    key: 'positive',
    label: 'Positive',
    colour: EMERALD,
  },
  {
    key: 'neutral',
    label: 'Neutral',
    colour: GRAY,
  },
  {
    key: 'mixed',
    label: 'Mixed',
    colour: AMBER,
  },
  {
    key: 'negative',
    label: 'Negative',
    colour: RED,
  },
];

/** Mentions with a sentiment label in `split`. */
export function labelledMentions(split: SentimentSplit): number {
  return split.positive + split.neutral + split.mixed + split.negative;
}

/** `count` as a % of a non-zero `total`, one decimal. */
function roundedShare(count: number, total: number): number {
  return Math.round((count / total) * 1000) / 10;
}

/** `count` as a % of `total`, one decimal; `null` without a total. */
export function percentOf(count: number, total: number): number | null {
  return total > 0 ? roundedShare(count, total) : null;
}

/**
 * One series per sentiment, one category per row: the sentiment's % of the
 * row's labelled mentions. A row without a labelled mention has no value
 * (an empty bar); nothing to draw without a row.
 */
export function sentimentSeries(rows: readonly SentimentRow[]): Array<ChartSeries<Sentiment>> {
  if (rows.length === 0) return [];
  return SENTIMENTS.map((sentiment) => ({
    key: sentiment.key,
    label: sentiment.label,
    colour: sentiment.colour,
    points: rows.map((row) => ({
      label: row.label,
      value: percentOf(row.split[sentiment.key], labelledMentions(row.split)),
    })),
  }));
}

/** A horizontal bar per row, its sentiments stacked to 100%. */
export function buildSentimentSplitChartConfiguration(
  series: readonly ChartSeries[],
  theme: ChartTheme,
  isDark: boolean,
): ChartConfiguration<'bar'> {
  return barChartConfiguration(series, isDark, {
    ...chartOptions(theme, {
      x: percentAxis(theme, { stacked: true }),
      y: themedAxis(theme, { stacked: true }),
    }),
    indexAxis: 'y',
  });
}

function rowInWords(row: SentimentRow): string {
  const total = labelledMentions(row.split);
  if (total === 0) return `${row.label}: no labelled mention.`;
  const shares = SENTIMENTS.map((sentiment) => `${roundedShare(row.split[sentiment.key], total).toFixed(1)}% ${sentiment.key}`);
  return `${row.label}: ${shares.join(', ')} of ${total} labelled mention${total === 1 ? '' : 's'}.`;
}

/** "Sentiment of the labelled mentions per row, stacked to 100%. Nike: 41.7% positive, … of 12 labelled mentions. Puma: no labelled mention." */
export function describeSentimentSplit(rows: readonly SentimentRow[]): string {
  if (rows.length === 0) return '';
  return ['Sentiment of the labelled mentions per row, stacked to 100%.', ...rows.map(rowInWords)].join(' ');
}
