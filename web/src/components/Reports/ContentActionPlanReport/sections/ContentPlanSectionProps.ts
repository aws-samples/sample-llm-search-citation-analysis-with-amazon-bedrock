import type {
  CitationGapsResponse,
  ContentIdea,
  ContentStudioHistory,
} from '../../../../types';
import type { useContentActionPlan } from '../useContentActionPlan';

/**
 * Props for the Content Action Plan sections that join all three data
 * sources (citation gaps, Content Studio ideas, generated briefs).
 */
export interface ContentPlanSectionProps {
  readonly gaps: CitationGapsResponse | null;
  readonly ideas: ReadonlyArray<ContentIdea>;
  readonly history: ReadonlyArray<ContentStudioHistory>;
  readonly loading: boolean;
  readonly error: string | null;
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
    loading: plan.gapsLoading || plan.studioLoading,
    error: plan.gapsError ?? plan.studioError,
  };
}
