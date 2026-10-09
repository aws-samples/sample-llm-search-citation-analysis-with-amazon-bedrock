import userEvent from '@testing-library/user-event';
import {
  render, screen
} from '@testing-library/react';
import {
  describe, expect, it, vi
} from 'vitest';
import type { KeywordExpansionResult } from '../../types';
import {
  buildMarketSelectionMock, renderWithMarketSelection
} from '../Markets/markets-fixtures';
import { KeywordExpansion } from './KeywordExpansion';
import { buildProps } from './KeywordExpansion-fixtures';
import {
  expansionKeywordFixtures, luxuryHotelsFixture, promoteKeyword
} from './expandedKeyword-fixtures';
import { mockApiPost } from './apiClientMock-fixtures';

vi.mock('../../api/client', () => import('./apiClientMock-fixtures'));

const PICKER_NAME = 'Market for new keywords';

const expansionResult: KeywordExpansionResult = {
  id: 'research-markets',
  seed_keyword: 'flights',
  industry: 'travel',
  keywords: expansionKeywordFixtures,
  keyword_count: expansionKeywordFixtures.length,
};

/** The expansion result with Chile picked in the header (Chile and Brazil configured). */
function renderChileanExpansion() {
  mockApiPost.mockReturnValue(new Promise(vi.fn()));
  return renderWithMarketSelection(
    <KeywordExpansion {...buildProps({ result: expansionResult })} />,
    buildMarketSelectionMock({ selectedMarketId: 'cl-es' }),
  );
}

describe('KeywordExpansion promotion market', () => {
  it('offers no market picker while no market is configured', () => {
    render(<KeywordExpansion {...buildProps({ result: expansionResult })} />);

    expect(screen.queryByLabelText(PICKER_NAME)).toBeNull();
  });

  it('starts on the market picked in the header', () => {
    renderChileanExpansion();

    expect(screen.getByLabelText(PICKER_NAME)).toHaveValue('cl-es');
  });

  it.each([
    {
      choice: 'Brazil (Portuguese)',
      body: expect.objectContaining({ market_id: 'br-pt' }),
    },
    {
      choice: 'No market',
      body: expect.not.objectContaining({ market_id: expect.anything() }),
    },
  ])('promotes into the chosen market when $choice is picked', async ({
    choice, body
  }) => {
    renderChileanExpansion();
    await userEvent.selectOptions(screen.getByLabelText(PICKER_NAME), choice);
    await promoteKeyword(luxuryHotelsFixture.keyword);

    expect(mockApiPost.mock.lastCall?.[1]).toStrictEqual(body);
  });
});
