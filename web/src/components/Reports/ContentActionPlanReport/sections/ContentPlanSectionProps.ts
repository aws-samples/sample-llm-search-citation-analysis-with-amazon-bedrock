import type {
  CitationGapsResponse,
  ContentIdea,
  ContentStudioHistory,
} from '../../../../types';

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
