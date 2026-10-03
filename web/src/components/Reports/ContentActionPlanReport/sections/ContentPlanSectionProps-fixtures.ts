import type {
  CitationGapsResponse, ContentIdea, ContentStudioHistory
} from '../../../../types';
import { buildContentStudioHistory } from '../../../ContentStudio/ContentStudioHistory-fixtures';
import { buildCitationGapsResponse } from '../../../Insights/CitationGaps-fixtures';
import { sectionPlaceholderCases } from '../../layout/sectionGate-fixtures';

/**
 * The citation gaps, ideas and generated briefs the Content Action Plan
 * sections read, and the placeholder states every section shows before its
 * data arrives.
 */

type BriefOverrides = NonNullable<Parameters<typeof buildContentStudioHistory>[0]>;
type KeywordGapSummary = NonNullable<CitationGapsResponse['keyword_summaries']>[number];

/** Cross-keyword gaps with one summary per keyword (no coverage) and totals summed over them. */
export function buildGaps(
  summaries: ReadonlyArray<Omit<KeywordGapSummary, 'coverage_rate'>>,
): CitationGapsResponse {
  return buildCitationGapsResponse({
    summary: {
      gap_count: summaries.reduce((total, summary) => total + summary.gap_count, 0),
      high_priority_gaps: summaries.reduce((total, summary) => total + summary.high_priority_gaps, 0),
      covered_count: 0,
      coverage_rate: 0,
    },
    keyword_summaries: summaries.map((summary) => ({
      ...summary,
      coverage_rate: 0,
    })),
  });
}

/** An open, high-priority idea for keyword `kw`, titled `id`, unless overridden. */
export function buildIdea(id: string, overrides: Partial<ContentIdea> = {}): ContentIdea {
  return {
    id,
    type: 'visibility_gap',
    priority: 'high',
    title: id,
    description: 'd',
    keyword: 'kw',
    source: 'analysis',
    actionable: true,
    content_angle: 'comprehensive_guide',
    ...overrides,
  };
}

/** An unviewed generated brief for keyword `kw`, whose idea and generated titles are both `id`, unless overridden. */
export function buildBrief(id: string, overrides: BriefOverrides = {}): ContentStudioHistory {
  const {
    generated_content: generatedContent, ...itemOverrides
  } = overrides;
  return buildContentStudioHistory({
    id,
    keyword: 'kw',
    idea_title: id,
    viewed: false,
    ...itemOverrides,
    generated_content: {
      title: id,
      ...generatedContent,
    },
  });
}

/** A section still loading (showing `loadingText`), then one whose fetch failed with `Backend down`. */
export function fetchPlaceholderCases(loadingText: RegExp) {
  return sectionPlaceholderCases(loadingText, 'Backend down');
}
