import {
  afterEach, beforeEach, describe, expect, it, vi
} from 'vitest';
import { mockAuthenticatedFetch } from '../../../test/infrastructureMock';
import { createMockJsonResponse } from '../../../test/fetchResponses';
import { GET_RETRY_DELAY_MAX_MS } from '../../../api/client';
import { fetchAllKeywordRuns } from './groupKpiDetail';
import { KEYWORD_HISTORIES } from './groupKpiHistory-fixtures';
import { HOTEL_SOL_SCOPE } from './GroupKpiReport-fixtures';

vi.mock('../../../infrastructure', () => import('../../../test/infrastructureMock'));

const TARGET = {
  scope: HOTEL_SOL_SCOPE,
  marketId: null,
};

describe('fetchAllKeywordRuns page retry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('collects every keyword page when one page answers 503 once and then succeeds', async () => {
    mockAuthenticatedFetch
      .mockResolvedValueOnce(createMockJsonResponse({
        keywords: [KEYWORD_HISTORIES[0]],
        next_token: 'page-2',
      }))
      .mockResolvedValueOnce(createMockJsonResponse({}, 503, 'Service Unavailable'))
      .mockResolvedValueOnce(createMockJsonResponse({
        keywords: [KEYWORD_HISTORIES[1]],
        next_token: null,
      }));

    const pending = fetchAllKeywordRuns(TARGET, 90);
    await vi.advanceTimersByTimeAsync(GET_RETRY_DELAY_MAX_MS);

    await expect(pending).resolves.toStrictEqual(KEYWORD_HISTORIES);
  });

  it('names the page and sends no second request when a keyword page answers 504', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({}, 504, 'Gateway Timeout'));

    await expect(fetchAllKeywordRuns(TARGET, 90)).rejects.toThrow('Keyword runs, page 1: Request timed out');
    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(1);
  });
});
