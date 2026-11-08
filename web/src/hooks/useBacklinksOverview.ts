import { fetchBacklinksOverview } from '../api/seoBacklinks';
import type {
  BacklinksOverviewResponse, BacklinksTargetRequest
} from '../types/api/seoBacklinks';
import {
  useSeoRequest, type SeoRequest
} from './useKeywordExplorerRequest';

/** The backlinks overview: one paid `POST /seo/backlinks/overview` per Search. */
export function useBacklinksOverview(): SeoRequest<BacklinksTargetRequest, BacklinksOverviewResponse> {
  return useSeoRequest(fetchBacklinksOverview);
}
