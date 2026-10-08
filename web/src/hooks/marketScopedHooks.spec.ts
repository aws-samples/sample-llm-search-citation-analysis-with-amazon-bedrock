import { useMarketScopedFetch } from './useMarketScopedFetch';
import type { ReportScope } from '../types';
import {
  act, renderHook, waitFor
} from '@testing-library/react';
import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import { answerEveryFetch } from '../test/fetchStubs';
import {
  CHILE_PICKED, firstRequestQuery
} from './marketScopedHooks-fixtures';
import { useCitationGaps } from './useCitationGaps';
import { useGroupKpiHistory } from './useGroupKpiHistory';
import { useHistoricalTrends } from './useHistoricalTrends';
import { useReportsOverview } from './useReportsOverview';
import { useSentimentExamples } from './useSentimentExamples';
import { useVisibilityMetrics } from './useVisibilityMetrics';
import { usePromptInsights } from './usePromptInsights';
import { useRecommendations } from './useRecommendations';
import { useReportInsights } from './useReportInsights';
import { useBrandMentions } from './useBrandMentions';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

const HOTEL_GROUP: ReportScope = {
  kind: 'group',
  groupId: 'hotel-sol',
};
const ONE_KEYWORD: ReportScope = {
  kind: 'keyword',
  keyword: 'vuelos baratos',
};

// The canned `{}` body fails every response guard; only the request is under test.
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(vi.fn());
  answerEveryFetch({});
});

describe('report hooks with a market picked in the header', () => {
  it.each([
    ['useCitationGaps', async () => {
      const { result } = renderHook(() => useCitationGaps(), { wrapper: CHILE_PICKED });
      await act(() => result.current.fetchCitationGaps(HOTEL_GROUP, 5));
    }],
    ['useGroupKpiHistory', async () => {
      const { result } = renderHook(() => useGroupKpiHistory(), { wrapper: CHILE_PICKED });
      await act(() => result.current.fetchGroupKpiHistory(HOTEL_GROUP, 30));
    }],
    ['useHistoricalTrends', async () => {
      const { result } = renderHook(() => useHistoricalTrends(), { wrapper: CHILE_PICKED });
      await act(() => result.current.fetchHistoricalTrends(HOTEL_GROUP, 'week', 90));
    }],
    ['useReportsOverview', async () => {
      const { result } = renderHook(() => useReportsOverview(), { wrapper: CHILE_PICKED });
      await act(() => result.current.fetchReportsOverview(30, 'day', 3, HOTEL_GROUP));
    }],
    ['useSentimentExamples', async () => {
      const { result } = renderHook(() => useSentimentExamples(), { wrapper: CHILE_PICKED });
      await act(() => result.current.fetchSentimentExamples(HOTEL_GROUP, 'negative'));
    }],
    ['useVisibilityMetrics', async () => {
      const { result } = renderHook(() => useVisibilityMetrics(), { wrapper: CHILE_PICKED });
      await act(() => result.current.fetchVisibilityMetrics(HOTEL_GROUP));
    }],
    ['usePromptInsights', async () => {
      const { result } = renderHook(() => usePromptInsights(HOTEL_GROUP), { wrapper: CHILE_PICKED });
      await act(() => result.current.fetchPromptInsights());
    }],
    ['useRecommendations', async () => {
      const { result } = renderHook(() => useRecommendations(HOTEL_GROUP), { wrapper: CHILE_PICKED });
      await act(() => result.current.fetchRecommendations());
    }],
  ])('%s asks for the group in the picked market', async (_hook, fetchGroup) => {
    await fetchGroup();

    expect(firstRequestQuery().get('market_id')).toBe('cl-es');
  });

  it.each<[string, () => unknown]>([
    ['useReportInsights', () => useReportInsights(HOTEL_GROUP, 30)],
    ['useBrandMentions', () => useBrandMentions(HOTEL_GROUP)],
  ])('%s reads the group in the picked market on mount', async (_hook, useScopedHook) => {
    renderHook(useScopedHook, { wrapper: CHILE_PICKED });

    await waitFor(() => expect(firstRequestQuery().get('market_id')).toBe('cl-es'));
  });

  it('keeps the group scope next to the market', async () => {
    const { result } = renderHook(() => useCitationGaps(), { wrapper: CHILE_PICKED });

    await act(() => result.current.fetchCitationGaps(HOTEL_GROUP));

    expect(firstRequestQuery().get('group_id')).toBe('hotel-sol');
  });

  it('sends no market for one keyword, which belongs to a single market', async () => {
    const { result } = renderHook(() => useVisibilityMetrics(), { wrapper: CHILE_PICKED });

    await act(() => result.current.fetchVisibilityMetrics(ONE_KEYWORD));

    expect(firstRequestQuery().has('market_id')).toBe(false);
  });

  it('sends no market outside a market selection', async () => {
    const { result } = renderHook(() => useHistoricalTrends());

    await act(() => result.current.fetchHistoricalTrends(HOTEL_GROUP));

    expect(firstRequestQuery().has('market_id')).toBe(false);
  });
});

describe('useMarketScopedFetch', () => {
  it('passes the picked market ahead of the call arguments', () => {
    const fetchData = vi.fn((marketId: string | null, scope: ReportScope, days: number) => `${marketId}:${scope.kind}:${days}`);
    const { result } = renderHook(() => useMarketScopedFetch(fetchData), { wrapper: CHILE_PICKED });

    expect(result.current(HOTEL_GROUP, 30)).toBe('cl-es:group:30');
  });

  it('passes no market outside a market selection', () => {
    const fetchData = vi.fn((marketId: string | null) => marketId);
    const { result } = renderHook(() => useMarketScopedFetch(fetchData));

    expect(result.current()).toBeNull();
  });
});
