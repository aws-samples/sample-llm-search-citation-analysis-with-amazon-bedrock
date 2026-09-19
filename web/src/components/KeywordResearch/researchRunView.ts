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
  onRetry?: (job: KeywordResearchItem) => void;
  onKeywordsAdded?: (created: Keyword[]) => void;
}
