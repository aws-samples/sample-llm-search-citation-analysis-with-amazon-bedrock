import type { SentimentSplit } from '../../../types/domain/groupKpiHistory';
import { labelledMentions } from '../charts/sentimentSplitChartConfiguration';

/** The mentions of the split's headline cards: positive, negative, and the rest together. */
export interface SentimentCounts {
  readonly positive: number;
  readonly negative: number;
  readonly neutralOrMixed: number;
  /** Mentions with a sentiment label. */
  readonly labelled: number;
}

export function sentimentCounts(split: SentimentSplit): SentimentCounts {
  return {
    positive: split.positive,
    negative: split.negative,
    neutralOrMixed: split.neutral + split.mixed,
    labelled: labelledMentions(split),
  };
}

/** "41.7% of 12 mentions with a sentiment", or why there is no share. */
export function sentimentShareNote(count: number, labelled: number): string {
  if (labelled === 0) return 'No mention with a sentiment yet';
  const mentions = labelled === 1 ? '1 mention' : `${labelled} mentions`;
  return `${((count / labelled) * 100).toFixed(1)}% of ${mentions} with a sentiment`;
}
