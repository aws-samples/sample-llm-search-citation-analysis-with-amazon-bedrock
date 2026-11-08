import { useMemo } from 'react';
import type {
  ListPaging, ListRequest 
} from '../../api/scopedListPages';
import {
  useScopedList, type ScopedList 
} from '../../hooks/useScopedList';
import { isRecord } from '../../types/domain/keywordDecoders';
import type {
  PromptInsight, PromptInsightsResponse 
} from '../../types';

/** A Prompt Insights tab: which prompts it lists. */
export type PromptTab = 'winning' | 'losing' | 'opportunities';

/** A key of the `/prompt-insights` answer, so a tab's list and cursor names are checked against it. */
type PromptInsightsKey = keyof PromptInsightsResponse & string;

const LIST_KEYS: Readonly<Record<PromptTab, {
  readonly list: PromptInsightsKey;
  readonly token: PromptInsightsKey;
  readonly total: string 
}>> = {
  winning: {
    list: 'winning_prompts',
    token: 'winning_prompts_next_token',
    total: 'summary.winning_count',
  },
  losing: {
    list: 'losing_prompts',
    token: 'losing_prompts_next_token',
    total: 'summary.losing_count',
  },
  opportunities: {
    list: 'opportunity_prompts',
    token: 'opportunity_prompts_next_token',
    total: 'summary.opportunity_count',
  },
};

/**
 * Where a tab's prompts sit in `/prompt-insights` (2.45.0 wave 5): `<list>`, its cursor
 * `<list>_next_token` and its count in `summary`; the next page is the same GET narrowed to the
 * tab (`type=<tab>`) with `next_token`, answering the same keys.
 */
export function promptTabPaging(tab: PromptTab): ListPaging {
  return {
    list: LIST_KEYS[tab].list,
    token: LIST_KEYS[tab].token,
    total: LIST_KEYS[tab].total,
    view: null,
  };
}

function isPromptInsight(value: unknown): value is PromptInsight {
  return isRecord(value) && typeof value.keyword === 'string' && typeof value.status === 'string';
}

/** The view's `type=all` request narrowed to one tab, for that tab's next pages. */
function tabRequest(request: ListRequest | null, tab: PromptTab): ListRequest | null {
  if (request === null) return null;
  const params = new URLSearchParams(request.params ?? '');
  params.set('type', tab);
  return {
    path: request.path,
    params,
  };
}

/** The active tab's prompts: the answer's first page, then "Load more" over the tab's cursor. */
export function usePromptTabList(
  insights: PromptInsightsResponse | null,
  request: ListRequest | null,
  tab: PromptTab,
): ScopedList<PromptInsight> {
  const paging = useMemo(() => promptTabPaging(tab), [tab]);
  const pageRequest = useMemo(() => tabRequest(request, tab), [request, tab]);
  return useScopedList(insights, pageRequest, paging, isPromptInsight);
}
