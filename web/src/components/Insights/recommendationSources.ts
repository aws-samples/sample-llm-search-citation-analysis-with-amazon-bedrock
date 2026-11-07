/**
 * The Action Center lists two sources in one list: the recommendations of the
 * AI answers (`GET /api/recommendations`) and those of the Google organic data
 * (`GET /api/seo/insights`). Both servers already rank their own list by
 * priority; this only merges them, keeping each source's order within a
 * priority, and tags each item with where it came from.
 */
import type {
  Recommendation, RecommendationsResponse, ReportScope
} from '../../types';
import type { SeoRecommendation } from '../../types/api/seoDomains';

export type RecommendationSource = 'geo' | 'seo';

export type ActionCenterRecommendation = Recommendation & { readonly source: RecommendationSource };

type PriorityCounts = RecommendationsResponse['by_priority'];

const PRIORITY_RANK: Readonly<Record<Recommendation['priority'], number>> = {
  high: 0,
  medium: 1,
  low: 2,
};

/** The SEO recommendations of the selected scope: one keyword's own, or all of them for a group or every keyword. */
export function seoRecommendationsForScope(
  recommendations: readonly SeoRecommendation[], scope: ReportScope
): SeoRecommendation[] {
  if (scope.kind !== 'keyword') return [...recommendations];
  return recommendations.filter((recommendation) => recommendation.keywords.includes(scope.keyword));
}

/** Both lists in one, highest priority first; within a priority the answer-based items come first. */
export function mergeRecommendations(
  geo: readonly Recommendation[], seo: readonly SeoRecommendation[]
): ActionCenterRecommendation[] {
  const tagged = [...tagSource(geo, 'geo'), ...tagSource(seo, 'seo')];
  // Array.prototype.sort is stable, so equal priorities keep the order above.
  return tagged.sort((left, right) => PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority]);
}

function tagSource(recommendations: readonly Recommendation[], source: RecommendationSource): ActionCenterRecommendation[] {
  return recommendations.map((recommendation) => ({
    ...recommendation,
    source,
  }));
}

/** The answer-based counts plus one per SEO recommendation of each priority. */
export function withSeoPriorities(geo: PriorityCounts, seo: readonly SeoRecommendation[]): PriorityCounts {
  const count = (priority: Recommendation['priority']) => seo.filter((item) => item.priority === priority).length;
  return {
    high: geo.high + count('high'),
    medium: geo.medium + count('medium'),
    low: geo.low + count('low'),
  };
}
