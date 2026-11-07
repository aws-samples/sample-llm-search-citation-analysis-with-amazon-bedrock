import { researchKeywords } from '../api/seo';
import type {
  KeywordResearchRequest, KeywordResearchResponse
} from '../types/api/seo';
import {
  useSeoRequest, type SeoRequest
} from './useKeywordExplorerRequest';

/** Keyword Explorer research: one paid `POST /seo/keywords/research` per Search click. */
export function useKeywordExplorer(): SeoRequest<KeywordResearchRequest, KeywordResearchResponse> {
  return useSeoRequest(researchKeywords);
}
