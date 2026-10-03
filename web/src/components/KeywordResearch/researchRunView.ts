import type {
  Keyword, KeywordResearchItem
} from '../../types';

/**
 * What `KeywordResearchView` hands every view that follows one research run
 * (keyword expansion, competitor analysis): the run's loading and error
 * state, the job to show progress for, and the promotion callbacks.
 */
export interface ResearchRunViewProps {
  loading: boolean;
  error: string | null;
  /** The job being followed (running or just finished), for progress and retry. */
  activeJob?: KeywordResearchItem | null;
  /** Re-run the failed steps of a partial or failed job. */
  onRetry?: (job: KeywordResearchItem) => void;
  onKeywordsAdded?: (created: Keyword[]) => void;
}

/** Row selection a keyword table offers when its rows can be promoted. */
export interface KeywordSelectionProps {
  selectable?: boolean;
  /** Selection keys (see `keywordSelectionKey`) of the ticked rows. */
  selected?: Set<string>;
  onToggle?: (keyword: string) => void;
}
