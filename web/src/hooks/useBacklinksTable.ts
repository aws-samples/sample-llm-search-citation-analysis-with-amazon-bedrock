import { useCallback } from 'react';
import { fetchBacklinksTable } from '../api/seoBacklinks';
import type {
  BacklinksTab, BacklinksTableRequest, BacklinksTableResponse
} from '../types/api/seoBacklinks';
import {
  useSeoRequest, type SeoRequest
} from './useKeywordExplorerRequest';

/**
 * One backlinks table: a paid page request per explicit change (search, tab,
 * page, page size, sort, applied filters, spam or link mode), never on focus.
 */
export function useBacklinksTable<TTab extends BacklinksTab>(
  tab: TTab
): SeoRequest<BacklinksTableRequest, BacklinksTableResponse<TTab>> {
  const call = useCallback(
    (request: BacklinksTableRequest, options: { signal: AbortSignal }) => fetchBacklinksTable(tab, request, options),
    [tab],
  );
  return useSeoRequest(call);
}
