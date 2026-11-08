import type {
  CitationGapsResponse,
  ContentIdea,
  ContentStudioHistory,
} from '../../../../types';
import type { SectionFetchState } from '../../layout';
import type { ListRequest } from '../../../../api/scopedListPages';
import type { useContentActionPlan } from '../useContentActionPlan';

/**
 * Props for the Content Action Plan sections that join all three data
 * sources (citation gaps, Content Studio ideas, generated briefs).
 */
export interface ContentPlanSectionProps extends SectionFetchState {
  readonly gaps: CitationGapsResponse | null;
  readonly ideas: ReadonlyArray<ContentIdea>;
  readonly history: ReadonlyArray<ContentStudioHistory>;
  /** The citation-gaps request: Export all of the coverage map exports its keyword summaries. */
  readonly gapsRequest?: ListRequest | null;
}

/**
 * The props of the joining sections: they wait for both fetches and surface
 * whichever failed first.
 */
export function joinedContentPlan(plan: ReturnType<typeof useContentActionPlan>): ContentPlanSectionProps {
  return {
    gaps: plan.gaps,
    ideas: plan.ideas,
    history: plan.history,
    gapsRequest: plan.gapsRequest,
    loading: plan.gapsLoading || plan.studioLoading,
    error: plan.gapsError ?? plan.studioError,
  };
}
