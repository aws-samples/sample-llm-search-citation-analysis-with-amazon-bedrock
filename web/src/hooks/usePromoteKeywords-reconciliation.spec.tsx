import { StrictMode } from 'react';
import {
  act, fireEvent, render, waitFor
} from '@testing-library/react';
import {
  describe, expect, it, vi 
} from 'vitest';
import { apiPost } from '../api/client';
import { ApiRequestError } from '../infrastructure';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import {
  MOCK_AUTHORITATIVE_KEYWORDS_URL,
  MOCK_KEYWORDS_URL,
  createMockFetch,
} from './useDashboardData-fixtures';
import { LATE_KEYWORD_RECONCILIATION_MS } from './useDashboardData';
import {
  availableKeywordFixtures,
  renderPendingPromotion,
  replacementAvailableKeywordFixtures,
  successfulPromotionResponseFixture,
} from './usePromoteKeywords-fixtures';
import {
  buildReconciliationWrapper,
  PendingPromotionOwnerHarness,
  promoteWithReconciliation,
} from './usePromoteKeywords-reconciliation-fixtures';

// useDashboardData (rendered by the reconciliation harness) imports the pure
// validateApiConfig from the same module, so keep the real implementation.
vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    apiPost: vi.fn(),
  };
});
vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

const mockApiPost = vi.mocked(apiPost);

class UnknownPromotionError extends Error {
  constructor() {
    super('Unexpected promotion failure');
    this.name = 'UnknownPromotionError';
  }
}

class PromotionAbortError extends Error {
  constructor() {
    super('Promotion aborted');
    this.name = 'AbortError';
  }
}

interface UncertainErrorCase {
  condition: string;
  error: Error;
}

/**
 * Failures after which the server may still have committed the promotion, so
 * the hook must refresh the authoritative keyword list.
 */
const uncertainErrorCases = [
  {
    condition: 'the server responds with HTTP 500',
    error: new ApiRequestError('HTTP 500: Server Error', 500),
  },
  {
    condition: 'the network request fails',
    error: new TypeError('Failed to fetch'),
  },
  {
    condition: 'an unknown request error occurs',
    error: new UnknownPromotionError(),
  },
  {
    condition: 'the server responds with HTTP 408',
    error: new ApiRequestError('Request timed out', 408),
  },
  {
    condition: 'the request aborts',
    error: new PromotionAbortError(),
  },
] satisfies UncertainErrorCase[];

describe('promotion keyword reconciliation', () => {
  it('requests authoritative refresh when promotion succeeds', async () => {
    const reconcileKeywords = vi.fn();
    mockApiPost.mockResolvedValue(successfulPromotionResponseFixture);

    await promoteWithReconciliation(reconcileKeywords);

    expect(reconcileKeywords).toHaveBeenCalledWith();
  });

  it.each(uncertainErrorCases)(
    'requests authoritative refresh when $condition',
    async ({ error }) => {
      const reconcileKeywords = vi.fn();
      mockApiPost.mockRejectedValue(error);

      await promoteWithReconciliation(reconcileKeywords);

      expect(reconcileKeywords).toHaveBeenCalledWith();
    }
  );

  it('does not request authoritative refresh when promotion receives a 400 rejection', async () => {
    const reconcileKeywords = vi.fn();
    mockApiPost.mockRejectedValue(new ApiRequestError('Keyword is invalid', {
      statusCode: 400,
      responseMessage: 'Keyword is invalid',
      field: 'keywords[0].keyword',
    }));

    await promoteWithReconciliation(reconcileKeywords);

    expect(reconcileKeywords).toHaveBeenCalledTimes(0);
  });

  it('requests authoritative refresh when pending promotion is abandoned', async () => {
    const reconcileKeywords = vi.fn();
    mockApiPost.mockReturnValue(new Promise(vi.fn()));
    const { rerender } = renderPendingPromotion({ wrapper: buildReconciliationWrapper(reconcileKeywords) });

    rerender({ availableKeywords: replacementAvailableKeywordFixtures });

    await waitFor(() => expect(reconcileKeywords).toHaveBeenCalledWith());
  });

  it('requests one authoritative refresh when pending promotion hook unmounts', () => {
    const reconcileKeywords = vi.fn();
    mockApiPost.mockReturnValue(new Promise(vi.fn()));
    const { unmount } = renderPendingPromotion({ wrapper: buildReconciliationWrapper(reconcileKeywords) });

    unmount();

    expect(reconcileKeywords).toHaveBeenCalledTimes(1);
    expect(reconcileKeywords).toHaveBeenCalledWith();
  });

  it('runs the two-phase authoritative refresh when a pending promotion child unmounts under StrictMode', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch());
    mockApiPost.mockReturnValue(new Promise(vi.fn()));
    const view = render(
      <StrictMode>
        <PendingPromotionOwnerHarness
          availableKeywords={availableKeywordFixtures}
          keywordToPromote="alpha"
        />
      </StrictMode>
    );
    await waitFor(() => expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
      MOCK_KEYWORDS_URL,
      { signal: expect.any(AbortSignal) }
    ));
    const requestCountBeforeChildUnmount = mockAuthenticatedFetch.mock.calls.length;
    vi.useFakeTimers();

    fireEvent.click(view.getByRole('button', { name: 'Select pending keyword' }));
    fireEvent.click(view.getByRole('button', { name: 'Start pending promotion' }));
    fireEvent.click(view.getByRole('button', { name: 'Leave keyword research' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LATE_KEYWORD_RECONCILIATION_MS);
    });

    const reconciliationUrls = mockAuthenticatedFetch.mock.calls
      .slice(requestCountBeforeChildUnmount)
      .map(([url]) => url);
    expect(reconciliationUrls).toStrictEqual([
      MOCK_AUTHORITATIVE_KEYWORDS_URL,
      MOCK_AUTHORITATIVE_KEYWORDS_URL,
    ]);
    vi.useRealTimers();
  });
});
