import type { KeywordResearchItem } from '../../types';
import { ResearchProgress } from './ResearchProgress';
import type { ResearchRunViewProps } from './researchRunView';

interface ResearchRunStatusProps extends Pick<ResearchRunViewProps, 'loading' | 'error' | 'activeJob' | 'onRetry'> {
  /** The job type this view follows; another type's job shows no progress here. */
  readonly jobType: KeywordResearchItem['type'];
}

/** Progress of the followed run (one step per provider, retry for failed ones) and the run error. */
export const ResearchRunStatus = ({
  jobType, loading, error, activeJob, onRetry
}: ResearchRunStatusProps) => (
  <>
    {activeJob?.type === jobType && (
      <ResearchProgress job={activeJob} onRetry={onRetry} retrying={loading} />
    )}
    {error && (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>
    )}
  </>
);
