import { vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
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
    <MemoryRouter>
      <ExecutionMonitor execution={null} triggerAnalysis={triggerAnalysis} keywordsCount={2} keywords={MARKET_KEYWORDS} />
    </MemoryRouter>,
    buildMarketSelectionMock(withMarkets ? {} : { catalog: { markets: [] } })
  );
  return triggerAnalysis;
}

/** Opens the collapsed "Limit to markets" filter and ticks the named markets (none: only opens it). */
export async function tickMarkets(...names: string[]): Promise<void> {
  await userEvent.click(await screen.findByRole('button', { name: /Limit to markets/u }));
  for (const name of names) {
    await userEvent.click(screen.getByRole('checkbox', { name }));
  }
}

/** Presses Start analysis once the monitor shows it. */
export async function pressStart(): Promise<void> {
  await userEvent.click(await screen.findByRole('button', { name: /Start analysis/u }));
}
