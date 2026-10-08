import { vi } from 'vitest';
import {
  buildGroup, buildKeyword
} from '../../api/keywordGroups-fixtures';
import { createMockJsonResponse } from '../../test/fetchResponses';
import { mockAuthenticatedFetch } from '../../test/infrastructureMock';
import { ExecutionMonitor } from './ExecutionMonitor';
import {
  buildMarketSelectionMock, renderWithMarketSelection
} from '../Markets/markets-fixtures';

export const HOTEL_SOL_GROUP = buildGroup({
  id: 'g-sol',
  name: 'Hotel Sol',
  keyword_count: 2,
});

export const MARKET_KEYWORDS = [
  buildKeyword({
    id: 'k-cl',
    keyword: 'hoteles en santiago',
    market_id: 'cl-es',
    status: 'active',
    group_ids: [HOTEL_SOL_GROUP.id],
  }),
  buildKeyword({
    id: 'k-global',
    keyword: 'hotels in santiago',
    status: 'active',
    group_ids: [HOTEL_SOL_GROUP.id],
  }),
];

/** Every request answered: one ready LLM provider for the preflight, the Hotel Sol group for the picker. */
export function answerProvidersAndGroups(): void {
  mockAuthenticatedFetch.mockImplementation((url) => Promise.resolve(createMockJsonResponse(
    String(url).endsWith('/keyword-groups')
      ? {
        groups: [HOTEL_SOL_GROUP],
        count: 1,
      }
      : {
        providers: [{
          name: 'openai',
          enabled: true,
          configured: true,
          type: 'llm',
        }],
      }
  )));
}

/** The monitor over `MARKET_KEYWORDS`, with or without configured markets; returns its `triggerAnalysis`. */
export function renderMarketMonitor(withMarkets = true) {
  const triggerAnalysis = vi.fn().mockResolvedValue({
    success: true,
    message: 'started',
  });
  renderWithMarketSelection(
    <ExecutionMonitor execution={null} triggerAnalysis={triggerAnalysis} keywordsCount={2} keywords={MARKET_KEYWORDS} />,
    buildMarketSelectionMock(withMarkets ? {} : { catalog: { markets: [] } })
  );
  return triggerAnalysis;
}
