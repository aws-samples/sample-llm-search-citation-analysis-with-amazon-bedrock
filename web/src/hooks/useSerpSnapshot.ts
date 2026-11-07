import { fetchSerp } from '../api/seo';
import type {
  SerpRequest, SerpResponse
} from '../types/api/seo';
import {
  useSeoRequest, type SeoRequest
} from './useKeywordExplorerRequest';

/** The organic results of the keyword the user clicked: one `POST /seo/serp` per click or "Load top 50". */
export function useSerpSnapshot(): SeoRequest<SerpRequest, SerpResponse> {
  return useSeoRequest(fetchSerp);
}
