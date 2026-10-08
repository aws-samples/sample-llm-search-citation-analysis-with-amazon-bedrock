import {
  act, renderHook, waitFor
} from '@testing-library/react';
import {
  describe, expect, it, vi
} from 'vitest';
import {
  mockApiGet, mockApiPut
} from '../api/clientMock-fixtures';
import {
  BRAZIL, CHILE
} from '../components/Markets/markets-fixtures';
import type { Market } from '../types';
import { useMarkets } from './useMarkets';

vi.mock('../api/client', () => import('../api/clientMock-fixtures'));

/** The hook once it has read `markets`. */
async function renderLoadedMarkets(markets: Market[]) {
  mockApiGet.mockResolvedValue({
    markets,
    updated_at: '2026-09-18T09:00:00Z',
  });
  const rendered = renderHook(() => useMarkets());
  await waitFor(() => expect(rendered.result.current.loaded).toBe(true));
  return rendered.result;
}

describe('useMarkets', () => {
  it('loads the configured markets on mount', async () => {
    const result = await renderLoadedMarkets([CHILE]);

    expect(result.current.markets).toStrictEqual([CHILE]);
  });

  it('reports a failed read and stays unloaded', async () => {
    mockApiGet.mockRejectedValue(new TypeError('Network down'));

    const { result } = renderHook(() => useMarkets());

    await waitFor(() => expect(result.current.error).toBe('Network down'));
    expect(result.current.loaded).toBe(false);
  });

  it('replaces the list with what a save stored', async () => {
    const result = await renderLoadedMarkets([CHILE]);
    mockApiPut.mockResolvedValue({
      markets: [CHILE, BRAZIL],
      updated_at: '2026-09-19T10:00:00Z',
    });

    await act(() => result.current.save([CHILE, BRAZIL]));

    expect(result.current.markets).toStrictEqual([CHILE, BRAZIL]);
    expect(result.current.saveOutcome).toStrictEqual({ status: 'saved' });
  });

  it('keeps the stored list and names the markets in use when a save is refused with 409', async () => {
    const result = await renderLoadedMarkets([CHILE, BRAZIL]);
    mockApiPut.mockResolvedValue({
      error: 'Markets still used by keywords',
      market_ids: ['br-pt'],
    });

    const saved = await act(() => result.current.save([CHILE]));

    expect(result.current.saveOutcome).toStrictEqual({
      status: 'failed',
      message: 'Markets still used by keywords',
      inUse: ['br-pt'],
    });
    expect(result.current.markets).toStrictEqual([CHILE, BRAZIL]);
    expect(saved).toBe(false);
  });
});
