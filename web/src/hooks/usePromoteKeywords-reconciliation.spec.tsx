import { StrictMode } from 'react';
import {
  act, fireEvent, render, renderHook, waitFor
} from '@testing-library/react';
import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import { apiPost } from '../api/client';
import {
  ApiRequestError, authenticatedFetch
} from '../infrastructure';
import {
  MOCK_AUTHORITATIVE_KEYWORDS_URL,
  MOCK_KEYWORDS_URL,
  createMockFetch,
} from './useDashboardData-fixtures';
import { LATE_KEYWORD_RECONCILIATION_MS } from './useDashboardData';
import {
  availableKeywordFixtures, successfulPromotionResponseFixture
} from './usePromoteKeywords-fixtures';
import {
  buildReconciliationWrapper, PendingPromotionOwnerHarness
} from './usePromoteKeywords-reconciliation-fixtures';
import { usePromoteKeywords } from './usePromoteKeywords';

// useDashboardData (rendered by the reconciliation harness) imports the pure
// validateApiConfig from the same module, so keep the real implementation.
vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    apiPost: vi.fn(),
  };
});
vi.mock('../infrastructure', async () => {
  const actualInfrastructure = await vi.importActual<typeof import('../infrastructure')>(
    '../infrastructure'
  );
  return {
    ...actualInfrastructure,
    API_BASE_URL: 'https://api.test.com',
    authenticatedFetch: vi.fn(),
  };
});

const mockApiPost = vi.mocked(apiPost);
const mockAuthenticatedFetch = vi.mocked(authenticatedFetch);

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

const uncertainErrorCases = [
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
] satisfies UncertainErrorCase[];

describe('promotion keyword reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requests authoritative refresh when promotion succeeds', async () => {
    const reconcileKeywords = vi.fn();
    mockApiPost.mockResolvedValue(successfulPromotionResponseFixture);
    const { result } = renderHook(
      () => usePromoteKeywords(availableKeywordFixtures),
      { wrapper: buildReconciliationWrapper(reconcileKeywords) }
    );

    act(() => result.current.toggle('alpha'));
    await act(() => result.current.promote());

    expect(reconcileKeywords).toHaveBeenCalledWith();
  });

  it('requests authoritative refresh when the server responds with HTTP 500', async () => {
    const reconcileKeywords = vi.fn();
    mockApiPost.mockRejectedValue(new ApiRequestError('HTTP 500: Server Error', 500));
    const { result } = renderHook(
      () => usePromoteKeywords(availableKeywordFixtures),
      { wrapper: buildReconciliationWrapper(reconcileKeywords) }
    );

    act(() => result.current.toggle('alpha'));
    await act(() => result.current.promote());

    expect(reconcileKeywords).toHaveBeenCalledWith();
  });

  it.each(uncertainErrorCases)(
    'requests authoritative refresh when $condition',
    async ({ error }) => {
      const reconcileKeywords = vi.fn();
      mockApiPost.mockRejectedValue(error);
      const { result } = renderHook(
        () => usePromoteKeywords(availableKeywordFixtures),
        { wrapper: buildReconciliationWrapper(reconcileKeywords) }
      );

      act(() => result.current.toggle('alpha'));
      await act(() => result.current.promote());

      expect(reconcileKeywords).toHaveBeenCalledWith();
    }
  );

  it('requests authoritative refresh when the request aborts', async () => {
    const reconcileKeywords = vi.fn();
    mockApiPost.mockRejectedValue(new PromotionAbortError());
    const { result } = renderHook(
      () => usePromoteKeywords(availableKeywordFixtures),
      { wrapper: buildReconciliationWrapper(reconcileKeywords) }
    );

    act(() => result.current.toggle('alpha'));
    await act(() => result.current.promote());

    expect(reconcileKeywords).toHaveBeenCalledWith();
  });

  it('does not request authoritative refresh when promotion receives a 400 rejection', async () => {
    const reconcileKeywords = vi.fn();
    mockApiPost.mockRejectedValue(new ApiRequestError('Keyword is invalid', {
      statusCode: 400,
      responseMessage: 'Keyword is invalid',
      field: 'keywords[0].keyword',
    }));
    const { result } = renderHook(
      () => usePromoteKeywords(availableKeywordFixtures),
      { wrapper: buildReconciliationWrapper(reconcileKeywords) }
    );

    act(() => result.current.toggle('alpha'));
    await act(() => result.current.promote());

    expect(reconcileKeywords).toHaveBeenCalledTimes(0);
  });

  it('requests authoritative refresh when pending promotion is abandoned', async () => {
    const reconcileKeywords = vi.fn();
    mockApiPost.mockReturnValue(new Promise(vi.fn()));
    const {
      result, rerender
    } = renderHook(
      ({ availableKeywords }) => usePromoteKeywords(availableKeywords),
      {
        initialProps: { availableKeywords: availableKeywordFixtures },
        wrapper: buildReconciliationWrapper(reconcileKeywords),
      }
    );

    act(() => result.current.toggle('alpha'));
    act(() => {
      void result.current.promote();
    });
    rerender({
      availableKeywords: [{
        keyword: 'beta',
        intent: 'informational',
        competition: 'low',
        relevance: 70,
      }],
    });

    await waitFor(() => expect(reconcileKeywords).toHaveBeenCalledWith());
  });

  it('requests one authoritative refresh when pending promotion hook unmounts', () => {
    const reconcileKeywords = vi.fn();
    mockApiPost.mockReturnValue(new Promise(vi.fn()));
    const {
      result, unmount
    } = renderHook(
      () => usePromoteKeywords(availableKeywordFixtures),
      { wrapper: buildReconciliationWrapper(reconcileKeywords) }
    );

    act(() => result.current.toggle('alpha'));
    act(() => {
      void result.current.promote();
    });
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
