import {
  act, screen
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  mockApiGet, mockApiPost
} from '../../api/clientMock-fixtures';
import type { Keyword } from '../../types';
import { KeywordsManager } from './KeywordsManager';
import {
  createKeywordsManagerProps, existingKeywordFixture
} from './KeywordsManager-fixtures';
import {
  buildMarketSelectionMock, renderWithMarketSelection
} from '../Markets/markets-fixtures';

/** "hotels" as a Chilean user types it: a translation of `existingKeywordFixture`. */
export const CHILEAN_KEYWORD = {
  id: 'keyword-cl',
  keyword: 'hoteles en santiago',
  created_at: '2024-01-02T00:00:00Z',
  status: 'active',
  market_id: 'cl-es',
  concept_id: existingKeywordFixture.id,
} satisfies Keyword;

/** The Brazilian translation of `existingKeywordFixture` the create call answers with. */
export const BRAZILIAN_KEYWORD = {
  id: 'keyword-br',
  keyword: 'hotéis',
  created_at: '2024-03-01T00:00:00Z',
  status: 'active',
  market_id: 'br-pt',
  concept_id: existingKeywordFixture.id,
} satisfies Keyword;

/** Renders the manager with Chile and Brazil configured (none with `withMarkets` false) once its groups loaded. */
export async function renderMarketKeywordsManager(keywords: Keyword[] = [existingKeywordFixture], withMarkets = true) {
  mockApiGet.mockResolvedValue({
    groups: [],
    count: 0,
  });
  const props = createKeywordsManagerProps(keywords);
  await act(async () => {
    renderWithMarketSelection(
      <KeywordsManager {...props} />,
      buildMarketSelectionMock(withMarkets ? {} : { catalog: { markets: [] } })
    );
    await Promise.resolve();
  });
  return props;
}

/** `POST /markets` proposes "hotéis" for Brazil; `POST /keywords` creates `BRAZILIAN_KEYWORD`. */
export function answerBrazilianSuggestion(): void {
  mockApiPost.mockImplementation((endpoint: string) => Promise.resolve(endpoint === '/markets' ? {
    suggestions: [{
      market_id: 'br-pt',
      keyword: 'hotéis',
    }],
  } : BRAZILIAN_KEYWORD));
}

/** Opens "Add to markets…" for "hotels", ticks Brazil and asks for suggestions. */
export async function requestBrazilianSuggestion(): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: 'Add hotels to markets' }));
  await userEvent.click(screen.getByRole('checkbox', { name: /Brazil/u }));
  await userEvent.click(screen.getByRole('button', { name: 'Suggest keywords' }));
}

/** The manager over `CHILEAN_KEYWORD` alone, its row open for editing. */
export async function startEditingChileanKeyword(): Promise<void> {
  await renderMarketKeywordsManager([CHILEAN_KEYWORD]);
  await userEvent.click(screen.getByRole('button', { name: 'Edit hoteles en santiago' }));
}
