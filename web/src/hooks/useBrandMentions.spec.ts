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
  it('returns null data when keyword is null', () => {
    const { result } = renderHook(() => useBrandMentions(null));

    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('fetches brand mentions when keyword provided', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch());

    const { result } = renderHook(() => useBrandMentions(kw('test keyword')));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toStrictEqual(mockBrandMentionsResponse);
    expect(result.current.error).toBeNull();
  });

  it('encodes keyword in URL', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch());

    renderHook(() => useBrandMentions(kw('best hotels in paris')));

    await waitFor(() => {
      expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
        expect.stringContaining('keyword=best+hotels+in+paris'),
        expect.any(Object)
      );
    });

    const url = mockAuthenticatedFetch.mock.calls[0][0] as string;
    expect(url).toContain('keyword=best+hotels+in+paris');
  });

  it('includes classification filter in URL when provided', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch());

    renderHook(() => useBrandMentions(kw('test'), 'first_party'));

    await waitFor(() => {
      expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
        expect.stringContaining('classification=first_party'),
        expect.any(Object)
      );
    });

    const url = mockAuthenticatedFetch.mock.calls[0][0] as string;
    expect(url).toContain('classification=first_party');
  });

  it('sets error when fetch fails', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch({ shouldFail: true }));

    const { result } = renderHook(() => useBrandMentions(kw('test')));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeTruthy();
    expect(result.current.data).toBeNull();
  });

  it('refetches when keyword changes', async () => {
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
      expect(mockAuthenticatedFetch.mock.calls.length).toBeGreaterThan(initialCallCount);
    });
  });

  it('refetches when classification filter changes', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch());

    const {
      result, rerender 
    } = renderHook(
      ({
        keyword, filter 
      }) => useBrandMentions(kw(keyword), filter),
      {
        initialProps: {
          keyword: 'test',
          filter: null as string | null 
        } 
      }
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    const initialCallCount = mockAuthenticatedFetch.mock.calls.length;

    rerender({
      keyword: 'test',
      filter: 'competitor' 
    });

    await waitFor(() => {
      expect(mockAuthenticatedFetch.mock.calls.length).toBeGreaterThan(initialCallCount);
    });
  });

  it('aborts pending request on unmount', async () => {
    const abortSpy = vi.spyOn(AbortController.prototype, 'abort');
    // Create a promise that never resolves
    mockAuthenticatedFetch.mockImplementation(() => new Promise(vi.fn()));

    const { unmount } = renderHook(() => useBrandMentions(kw('test')));

    unmount();

    expect(abortSpy).toHaveBeenCalledWith();
    abortSpy.mockRestore();
  });

  it('clears data when keyword changes to null', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch());

    const {
      result, rerender 
    } = renderHook(
      ({ keyword }) => useBrandMentions(keyword === null ? null : kw(keyword)),
      { initialProps: { keyword: 'test' as string | null } }
    );

    await waitFor(() => expect(result.current.data).not.toBeNull());

    rerender({ keyword: null });

    expect(result.current.data).toBeNull();
  });

  it('sets loading true while fetching', async () => {
    const deferred = createDeferredResponse();
    mockAuthenticatedFetch.mockImplementation(() => deferred.promise);

    const { result } = renderHook(() => useBrandMentions(kw('test')));

    expect(result.current.loading).toBe(true);

    deferred.resolve(createMockJsonResponse(mockBrandMentionsResponse));

    await waitFor(() => expect(result.current.loading).toBe(false));
  });
});
