import {
  describe, it, expect, vi
} from 'vitest';
import {
  renderHook, waitFor
} from '@testing-library/react';
import { useBrandMentions } from './useBrandMentions';
import {
  mockBrandMentionsResponse, createMockFetch
} from './useBrandMentions-fixtures';
import { createMockJsonResponse } from '../test/fetchResponses';
import { keywordScope as kw } from '../components/ui/reportScope-fixtures';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

import {
  deferAuthenticatedFetch, mockAuthenticatedFetch 
} from '../test/infrastructureMock';

interface BrandMentionsProps {
  keyword: string;
  filter: string | null;
}

describe('useBrandMentions', () => {
  it('returns an empty state when scope is null', () => {
    const { result } = renderHook(() => useBrandMentions(null));

    expect(result.current).toStrictEqual({
      data: null,
      loading: false,
      error: null,
    });
  });

  it('returns brand mentions when the request succeeds', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch());

    const { result } = renderHook(() => useBrandMentions(kw('test keyword')));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toStrictEqual(mockBrandMentionsResponse);
    expect(result.current.error).toBeNull();
  });

  it('includes the encoded keyword when building the request URL', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch());

    renderHook(() => useBrandMentions(kw('best hotels in paris')));

    await waitFor(() => {
      expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
        expect.stringContaining('keyword=best+hotels+in+paris'),
        expect.any(Object)
      );
    });
  });

  it('includes classification when a filter is selected', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch());

    renderHook(() => useBrandMentions(kw('test'), 'first_party'));

    await waitFor(() => {
      expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
        expect.stringContaining('classification=first_party'),
        expect.any(Object)
      );
    });
  });

  it('includes timestamp when a historical run is selected', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch());

    renderHook(() => useBrandMentions(
      kw('test'),
      null,
      null,
      '2026-01-10T00:00:00Z'
    ));

    await waitFor(() => {
      expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
        expect.stringContaining('timestamp=2026-01-10T00%3A00%3A00Z'),
        expect.any(Object)
      );
    });
  });

  it('reports the brands server-error message when the fetch fails', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch({ shouldFail: true }));

    const { result } = renderHook(() => useBrandMentions(kw('test')));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('Failed to load brand mentions');
    expect(result.current.data).toBeNull();
  });

  it.each<[change: string, initialProps: BrandMentionsProps, nextProps: BrandMentionsProps]>([
    ['the keyword changes', {
      keyword: 'keyword1',
      filter: null,
    }, {
      keyword: 'keyword2',
      filter: null,
    }],
    ['the classification filter changes', {
      keyword: 'test',
      filter: null,
    }, {
      keyword: 'test',
      filter: 'competitor',
    }],
  ])('refetches when %s', async (_change, initialProps, nextProps) => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch());

    const {
      result, rerender
    } = renderHook(
      ({
        keyword, filter 
      }: BrandMentionsProps) => useBrandMentions(kw(keyword), filter),
      { initialProps }
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    const initialCallCount = mockAuthenticatedFetch.mock.calls.length;

    rerender(nextProps);

    await waitFor(() => {
      expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(initialCallCount + 1);
    });
  });

  it('aborts the pending request when the hook unmounts', () => {
    const abortSpy = vi.spyOn(AbortController.prototype, 'abort');
    mockAuthenticatedFetch.mockImplementation(() => new Promise(vi.fn()));

    const { unmount } = renderHook(() => useBrandMentions(kw('test')));

    unmount();

    expect(abortSpy).toHaveBeenCalledWith();
    abortSpy.mockRestore();
  });

  it('clears response data when the scope becomes null', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch());
    const initialProps: { keyword: string | null } = { keyword: 'test' };

    const {
      result, rerender
    } = renderHook(
      ({ keyword }) => useBrandMentions(keyword === null ? null : kw(keyword)),
      { initialProps }
    );

    await waitFor(() => expect(result.current.data).toStrictEqual(mockBrandMentionsResponse));

    rerender({ keyword: null });

    expect(result.current.data).toBeNull();
  });

  it('reports loading while the request is pending', async () => {
    const deferred = deferAuthenticatedFetch();

    const { result } = renderHook(() => useBrandMentions(kw('test')));

    expect(result.current.loading).toBe(true);

    deferred.resolve(createMockJsonResponse(mockBrandMentionsResponse));

    await waitFor(() => expect(result.current.loading).toBe(false));
  });
});
