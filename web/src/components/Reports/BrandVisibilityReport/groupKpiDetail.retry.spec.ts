import {
  describe, expect, it, vi
} from 'vitest';
import { mockAuthenticatedFetch } from '../../../test/infrastructureMock';
import { createMockJsonResponse } from '../../../test/fetchResponses';
import { fetchAllKeywordRuns } from './groupKpiDetail';
import {
  FIRST_KEYWORD_RUNS_PAGE, KEYWORD_HISTORIES, LAST_KEYWORD_RUNS_PAGE
} from './groupKpiHistory-fixtures';
import { HOTEL_SOL_SCOPE } from './GroupKpiReport-fixtures';

// The real `apiGet` over a stubbed network, so each page gets the client's retry.
vi.mock('../../../infrastructure', () => import('../../../test/infrastructureMock'));

const GROUP_TARGET = {
  scope: HOTEL_SOL_SCOPE,
  marketId: null,
};

describe('fetchAllKeywordRuns over the real client', () => {
  it('collects every keyword page when one page answers 503 once and then succeeds', async () => {
    mockAuthenticatedFetch
      .mockResolvedValueOnce(createMockJsonResponse(FIRST_KEYWORD_RUNS_PAGE))
      .mockResolvedValueOnce(createMockJsonResponse({}, 503, 'Service Unavailable'))
      .mockResolvedValueOnce(createMockJsonResponse(LAST_KEYWORD_RUNS_PAGE));

    await expect(fetchAllKeywordRuns(GROUP_TARGET, 90)).resolves.toStrictEqual(KEYWORD_HISTORIES);
  });

  it('names the page and sends no second request when a keyword page answers 504', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({}, 504, 'Gateway Timeout'));

    await expect(fetchAllKeywordRuns(GROUP_TARGET, 90)).rejects.toThrow('Keyword runs, page 1: Request timed out');
    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(1);
  });
});
