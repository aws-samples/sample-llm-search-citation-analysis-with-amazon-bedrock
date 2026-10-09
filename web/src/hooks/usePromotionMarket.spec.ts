import {
  describe, expect, it
} from 'vitest';
import {
  act, renderHook
} from '@testing-library/react';
import {
  buildMarketSelectionMock, marketSelectionWrapper
} from '../components/Markets/markets-fixtures';
import { usePromotionMarket } from './usePromotionMarket';

/** `usePromotionMarket()` under a header with `market` picked and, unless `noMarkets`, Chile and Brazil configured. */
function renderPromotionMarket(market: string | null, noMarkets = false) {
  const selection = buildMarketSelectionMock({
    selectedMarketId: market,
    ...(noMarkets ? { catalog: { markets: [] } } : {}),
  });
  return renderHook(() => usePromotionMarket(), { wrapper: marketSelectionWrapper(selection) });
}

describe('usePromotionMarket', () => {
  it('defaults to the market picked in the header', () => {
    const { result } = renderPromotionMarket('br-pt');

    expect(result.current.marketId).toBe('br-pt');
  });

  it('defaults to no market while every market is combined', () => {
    const { result } = renderPromotionMarket(null);

    expect(result.current.marketId).toBeNull();
  });

  it('defaults to no market when the header shows the keywords without one', () => {
    const { result } = renderPromotionMarket('global');

    expect(result.current.marketId).toBeNull();
  });

  it.each([
    ['another market', 'cl-es'],
    ['no market', null],
  ])('keeps an explicit choice of %s over the header market', (_choice, marketId) => {
    const { result } = renderPromotionMarket('br-pt');

    act(() => result.current.choose(marketId));

    expect(result.current.marketId).toBe(marketId);
  });

  it('offers no markets and chooses none when no market is configured', () => {
    const { result } = renderPromotionMarket('cl-es', true);

    expect([result.current.markets, result.current.marketId]).toStrictEqual([[], null]);
  });
});
