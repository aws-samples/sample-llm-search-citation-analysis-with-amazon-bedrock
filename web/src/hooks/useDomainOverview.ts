import {
  fetchDomainKeywords, fetchDomainOverview, fetchDomainPages, fetchSerpCompetitors
} from '../api/seoDomains';
import type {
  DomainKeywordsRequest,
  DomainKeywordsResponse,
  DomainOverviewResponse,
  DomainPagesRequest,
  DomainPagesResponse,
  DomainTargetRequest,
  SerpCompetitorsRequest,
  SerpCompetitorsResponse,
} from '../types/api/seoDomains';
import {
  useSeoRequest, type SeoRequest
} from './useKeywordExplorerRequest';

export interface DomainOverviewRequests {
  readonly overview: SeoRequest<DomainTargetRequest, DomainOverviewResponse>;
  readonly keywords: SeoRequest<DomainKeywordsRequest, DomainKeywordsResponse>;
  readonly pages: SeoRequest<DomainPagesRequest, DomainPagesResponse>;
  readonly competitors: SeoRequest<SerpCompetitorsRequest, SerpCompetitorsResponse>;
}

/**
 * The four paid Domain Overview lookups, each sent only by `run` (a click:
 * Analyze, a page, a sort, Apply, "Load top pages", "Find competitors"); none
 * is fetched on mount, focus or retry. Only each lookup's latest answer is kept.
 */
export function useDomainOverview(): DomainOverviewRequests {
  return {
    overview: useSeoRequest(fetchDomainOverview),
    keywords: useSeoRequest(fetchDomainKeywords),
    pages: useSeoRequest(fetchDomainPages),
    competitors: useSeoRequest(fetchSerpCompetitors),
  };
}
