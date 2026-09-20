import {
  describe, expect, it, vi
} from 'vitest';
import { act } from '@testing-library/react';
import { createMockJsonResponse } from '../test/fetchResponses';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import {
  probeResponse,
  renderDeferredProbeEndpoint,
  renderProbeEndpoint,
} from './useAnalysisEndpoint-fixtures';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

describe('useAnalysisEndpoint request cleanup', () => {
  it('clears the previous error as soon as a retry starts', async () => {
    mockAuthenticatedFetch
      .mockResolvedValueOnce(createMockJsonResponse({}, 500))
      .mockImplementationOnce(() => new Promise<Response>(vi.fn()));
    const {
      result, unmount
    } = renderProbeEndpoint();
    await act(() => result.current.fetchData('first'));
    expect(result.current.error).toBe('Unable to load visibility metrics');

    act(() => {
      void result.current.fetchData('retry');
    });

    expect(result.current.error).toBeNull();
    unmount();
  });

  it('does not abort a completed request when the next request starts', async () => {
    const {
      deferred, startFetch, unmount
    } = renderDeferredProbeEndpoint();
    const first = startFetch('first');
    const completedSignal = deferred.requests[0].signal;
    await act(async () => {
      deferred.requests[0].respond(probeResponse);
      await first;
    });

    startFetch('second');

    expect(completedSignal?.aborted).toBe(false);
    unmount();
  });
});
