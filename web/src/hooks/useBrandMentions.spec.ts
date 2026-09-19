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
import {
  createDeferredResponse, createMockJsonResponse
} from '../test/fetchResponses';
import { keywordScope as kw } from '../components/ui/reportScope-fixtures';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

import { mockAuthenticatedFetch } from '../test/infrastructureMock';

describe('useBrandMentions', () => {
  it('returns an empty state when scope is null', () => {
    const { result } = renderHook(() => useBrandMentions(null));

    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
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

  it('returns a brand error when the request fails', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch({ shouldFail: true }));

    const { result } = renderHook(() => useBrandMentions(kw('test')));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('Failed to load brand mentions');
    expect(result.current.data).toBeNull();
  });

  it('requests new data when the keyword changes', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch());

    const {
      result, rerender
    } = renderHook(
      ({ keyword }) => useBrandMentions(kw(keyword)),
      { initialProps: { keyword: 'keyword1' } }
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    const initialCallCount = mockAuthenticatedFetch.mock.calls.length;

    rerender({ keyword: 'keyword2' });

    await waitFor(() => {
      expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(initialCallCount + 1);
    });
  });

  it('requests new data when the classification changes', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch());
    const initialProps: {
      keyword: string;
      filter: string | null
    } = {
      keyword: 'test',
      filter: null,
    };

    const {
      result, rerender
    } = renderHook(
      ({
        keyword, filter
      }) => useBrandMentions(kw(keyword), filter),
      { initialProps }
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    const initialCallCount = mockAuthenticatedFetch.mock.calls.length;

    rerender({
      keyword: 'test',
      filter: 'competitor'
    });

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
    const deferred = createDeferredResponse();
    mockAuthenticatedFetch.mockImplementation(() => deferred.promise);

    const { result } = renderHook(() => useBrandMentions(kw('test')));

    expect(result.current.loading).toBe(true);

    deferred.resolve(createMockJsonResponse(mockBrandMentionsResponse));

    await waitFor(() => expect(result.current.loading).toBe(false));
  });
});
