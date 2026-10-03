import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  renderHook, waitFor
} from '@testing-library/react';
import { ApiRequestError } from '../infrastructure';
import type {
  AlertAcknowledgement, AlertsResponse
} from '../types';
import {
  buildAlertItem,
  buildAlertsResponse,
} from '../types/domain/alerts-fixtures';
import {
  acknowledgeAlert as mockAcknowledgeAlert,
  fetchAlerts as mockFetchAlerts,
  prepareAlertHookTest,
} from './alertsApiMock-fixtures';
import { AlertHookFailure } from './alertHookErrors-fixtures';
import {
  beginAlertAcknowledgement,
  beginDeferredRefresh,
  beginHookRequest,
  callAfterUnmount,
  completeAcknowledgement,
  createDeferredValue,
  deferNextCall,
  renderLoadedOpenAlerts,
  resolveAcknowledgement,
  resolveDeferredValue,
  serveTwoOpenAlerts,
} from './useAlerts-fixtures';
import { deferNextTwoCalls } from '../test/fetchResponses';
import { useOpenAlerts } from './useAlerts';

vi.mock('../api/alerts', () => import('./alertsApiMock-fixtures'));

beforeEach(prepareAlertHookTest);

describe('useOpenAlerts lifecycle', () => {
  it('starts with an empty loading state while the initial request is pending', () => {
    deferNextCall(mockFetchAlerts);

    const { result } = renderHook(() => useOpenAlerts());

    expect({
      items: result.current.items,
      count: result.current.count,
      loading: result.current.loading,
      error: result.current.error,
      actionError: result.current.actionError,
      acknowledgingIds: result.current.acknowledgingIds,
    }).toStrictEqual({
      items: [],
      count: 0,
      loading: true,
      error: null,
      actionError: null,
      acknowledgingIds: [],
    });
  });

  it('reports loading and clears the previous load error while a retry is pending', async () => {
    mockFetchAlerts.mockRejectedValueOnce(new ApiRequestError('HTTP 500', 500));
    const { result } = await renderLoadedOpenAlerts();
    const refresh = beginDeferredRefresh(mockFetchAlerts, result.current, buildAlertsResponse());

    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();

    await refresh.finish();
  });

  it('keeps the current retry loading when a stale request settles first', async () => {
    mockFetchAlerts.mockReset();
    const [stale, current] = deferNextTwoCalls<AlertsResponse>(mockFetchAlerts);
    const { result } = renderHook(() => useOpenAlerts());
    await waitFor(() => expect(mockFetchAlerts).toHaveBeenCalledTimes(1));

    const pendingCurrent = beginHookRequest(result.current.refresh);
    await resolveDeferredValue(stale, buildAlertsResponse(), stale.promise);

    expect(result.current.loading).toBe(true);

    await resolveDeferredValue(current, buildAlertsResponse(), pendingCurrent);
  });

  it('does not abort a completed load when a later refresh starts', async () => {
    const { result } = await renderLoadedOpenAlerts();
    const completedSignal = mockFetchAlerts.mock.calls[0][0].signal;
    const refresh = beginDeferredRefresh(mockFetchAlerts, result.current, buildAlertsResponse());

    expect(completedSignal?.aborted).toBe(false);

    await refresh.finish();
  });

  it('reloads alerts with the new limit when the limit changes', async () => {
    const { rerender } = renderHook(
      ({ limit }) => useOpenAlerts(limit),
      { initialProps: { limit: 20 } }
    );
    await waitFor(() => expect(mockFetchAlerts).toHaveBeenCalledTimes(1));

    rerender({ limit: 5 });

    await waitFor(() => expect(mockFetchAlerts).toHaveBeenCalledTimes(2));
    expect(mockFetchAlerts.mock.calls[1][0]).toStrictEqual({
      status: 'open',
      limit: 5,
      signal: expect.any(AbortSignal),
    });
  });

  it('returns cancellation without an API request when acknowledgement starts after unmount', async () => {
    const outcome = await callAfterUnmount(
      renderLoadedOpenAlerts,
      mockAcknowledgeAlert,
      (hook) => hook.acknowledge(buildAlertItem().id)
    );

    expect(outcome).toStrictEqual({
      success: false,
      message: 'Alert acknowledgement cancelled.',
    });
    expect(mockAcknowledgeAlert).not.toHaveBeenCalled();
  });

  it('tracks each pending acknowledgement and removes only the settled id', async () => {
    const [firstAlert, secondAlert] = serveTwoOpenAlerts();
    const [first, second] = deferNextTwoCalls<AlertAcknowledgement>(mockAcknowledgeAlert);
    const { result } = await renderLoadedOpenAlerts();

    const firstPending = beginAlertAcknowledgement(result.current, firstAlert.id);
    const secondPending = beginAlertAcknowledgement(result.current, secondAlert.id);
    expect(result.current.acknowledgingIds).toStrictEqual([firstAlert.id, secondAlert.id]);

    await resolveAcknowledgement(first, firstAlert.id, firstPending);
    expect(result.current.acknowledgingIds).toStrictEqual([secondAlert.id]);

    await resolveAcknowledgement(second, secondAlert.id, secondPending);
  });

  it('tracks a repeated pending acknowledgement id only once', async () => {
    const deferred = createDeferredValue<AlertAcknowledgement>();
    const alertId = buildAlertItem().id;
    mockAcknowledgeAlert.mockReturnValue(deferred.promise);
    const { result } = await renderLoadedOpenAlerts();

    const firstPending = beginAlertAcknowledgement(result.current, alertId);
    const secondPending = beginAlertAcknowledgement(result.current, alertId);

    expect(result.current.acknowledgingIds).toStrictEqual([alertId]);

    const bothPending = Promise.all([firstPending, secondPending]);
    await resolveAcknowledgement(deferred, alertId, bothPending);
  });

  it('aborts a pending load and stops its loading state when acknowledgement starts', async () => {
    const { result } = await renderLoadedOpenAlerts();
    const load = deferNextCall<AlertsResponse>(mockFetchAlerts);
    const acknowledgement = deferNextCall<AlertAcknowledgement>(mockAcknowledgeAlert);
    const pendingLoad = beginHookRequest(result.current.refresh);
    const loadSignal = mockFetchAlerts.mock.calls[1][0].signal;

    const pendingAcknowledgement = beginAlertAcknowledgement(result.current);

    expect(loadSignal?.aborted).toBe(true);
    expect(result.current.loading).toBe(false);

    load.resolve(buildAlertsResponse());
    await resolveAcknowledgement(
      acknowledgement,
      buildAlertItem().id,
      Promise.all([pendingLoad, pendingAcknowledgement])
    );
  });

  it('clears the previous acknowledgement error while a retry is pending', async () => {
    mockAcknowledgeAlert.mockRejectedValueOnce(new AlertHookFailure());
    const { result } = await renderLoadedOpenAlerts();
    await completeAcknowledgement(result.current);
    const deferred = deferNextCall<AlertAcknowledgement>(mockAcknowledgeAlert);

    const pending = beginAlertAcknowledgement(result.current);

    expect(result.current.actionError).toBeNull();

    await resolveAcknowledgement(deferred, buildAlertItem().id, pending);
  });

  it('returns the alert-safe message when acknowledgement fails unexpectedly', async () => {
    mockAcknowledgeAlert.mockRejectedValueOnce(new AlertHookFailure());
    const { result } = await renderLoadedOpenAlerts();

    const outcome = await completeAcknowledgement(result.current);

    expect({
      actionError: result.current.actionError,
      outcome,
    }).toStrictEqual({
      actionError: 'Failed to process alert request',
      outcome: {
        success: false,
        message: 'Failed to process alert request',
      },
    });
  });
});
