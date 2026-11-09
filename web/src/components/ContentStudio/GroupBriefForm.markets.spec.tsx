import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import { screen } from '@testing-library/react';
import { prepareGroupBriefClientIdMocks } from './GroupBriefForm-client-id-fixtures';
import {
  buildContentBriefGroupScope,
  chooseSpecificKeywords,
  confirmGroupBrief,
  renderGroupBriefForm,
  renderGroupBriefFormWithMarkets,
  reviewGroupBrief,
  selectGroupForBrief,
  selectPerKeywordStrategy,
  tickBriefMarket,
} from './GroupBriefForm-fixtures';

vi.mock('../../hooks/useKeywordGroups');
vi.mock('../../hooks/useContentBriefTemplates');

beforeEach(prepareGroupBriefClientIdMocks);

describe('GroupBriefForm markets', () => {
  it('offers no market filter while no market is configured', () => {
    renderGroupBriefForm();

    expect(screen.queryByText('None ticked: keywords of every market run.')).toBeNull();
  });

  it('lists only the keywords of the ticked market', async () => {
    renderGroupBriefFormWithMarkets();
    await tickBriefMarket('Chile (Spanish)');
    await chooseSpecificKeywords();

    expect(screen.getByRole('checkbox', { name: 'Alpha keyword' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Beta keyword' })).not.toBeInTheDocument();
  });

  it('previews only the group members of the ticked market', async () => {
    renderGroupBriefFormWithMarkets();
    await tickBriefMarket('Chile (Spanish)');
    await selectGroupForBrief();

    expect(screen.getByText('1 active keyword in Generic Group')).toBeInTheDocument();
  });

  it.each([
    {
      strategy: 'per-keyword batch',
      market: 'Chile (Spanish)',
      marketId: 'cl-es',
      chooseStrategy: selectPerKeywordStrategy,
      request: 'onGenerateBatch',
    },
    {
      strategy: 'combined brief',
      market: 'No market',
      marketId: 'global',
      chooseStrategy: vi.fn(),
      request: 'onGenerate',
    },
  ] as const)('sends the ticked market in the $strategy scope', async ({
    market, marketId, chooseStrategy, request
  }) => {
    const formProps = renderGroupBriefFormWithMarkets();
    await tickBriefMarket(market);
    await selectGroupForBrief();
    await chooseStrategy();
    await reviewGroupBrief();
    await confirmGroupBrief(1);

    expect(formProps[request]).toHaveBeenCalledWith(expect.objectContaining({
      scope: {
        ...buildContentBriefGroupScope(['group-1']),
        market_ids: [marketId],
      },
    }));
  });
});
