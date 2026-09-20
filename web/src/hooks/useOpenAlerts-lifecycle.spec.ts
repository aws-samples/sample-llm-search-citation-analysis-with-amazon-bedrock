import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  act, renderHook, waitFor
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
  beginHookRequest,
  buildAlertAcknowledgement,
  createDeferredValue,
  renderLoadedOpenAlerts,
  resolveDeferredValue,
} from './useAlerts-fixtures';
import { useOpenAlerts } from './useAlerts';

vi.mock('../api/alerts', () => import('./alertsApiMock-fixtures'));

beforeEach(prepareAlertHookTest);

describe('useOpenAlerts lifecycle', () => {
  it('starts with an empty loading state while the initial request is pending', () => {
    const deferred = createDeferredValue<AlertsResponse>();
    mockFetchAlerts.mockReturnValue(deferred.promise);

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
    const deferred = createDeferredValue<AlertsResponse>();
    mockFetchAlerts.mockReturnValueOnce(deferred.promise);

    const pending = beginHookRequest(result.current.refresh);

    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();

    await resolveDeferredValue(deferred, buildAlertsResponse(), pending);
  });

  it('keeps the current retry loading when a stale request settles first', async () => {
    const stale = createDeferredValue<AlertsResponse>();
    const current = createDeferredValue<AlertsResponse>();
    mockFetchAlerts
      .mockReset()
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(current.promise);
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
    const deferred = createDeferredValue<AlertsResponse>();
    mockFetchAlerts.mockReturnValueOnce(deferred.promise);

    const pending = beginHookRequest(result.current.refresh);

    expect(completedSignal?.aborted).toBe(false);

    await resolveDeferredValue(deferred, buildAlertsResponse(), pending);
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
    const {
      result, unmount
    } = await renderLoadedOpenAlerts();
    const acknowledgeAfterUnmount = result.current.acknowledge;
    mockAcknowledgeAlert.mockClear();
    unmount();

    const outcome = await acknowledgeAfterUnmount(buildAlertItem().id);

    expect(outcome).toStrictEqual({
      success: false,
      message: 'Alert acknowledgement cancelled.',
    });
    expect(mockAcknowledgeAlert).not.toHaveBeenCalled();
  });

  it('tracks each pending acknowledgement and removes only the settled id', async () => {
    const first = createDeferredValue<AlertAcknowledgement>();
    const second = createDeferredValue<AlertAcknowledgement>();
    const firstAlert = buildAlertItem();
    const secondAlert = buildAlertItem({ id: 'alert-2' });
    mockFetchAlerts.mockResolvedValue(buildAlertsResponse({
      items: [firstAlert, secondAlert],
      count: 2,
    }));
    mockAcknowledgeAlert
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { result } = await renderLoadedOpenAlerts();

    const firstPending = beginHookRequest(() => result.current.acknowledge(firstAlert.id));
    const secondPending = beginHookRequest(() => result.current.acknowledge(secondAlert.id));
    expect(result.current.acknowledgingIds).toStrictEqual([firstAlert.id, secondAlert.id]);

    await resolveDeferredValue(first, buildAlertAcknowledgement(firstAlert.id), firstPending);
    expect(result.current.acknowledgingIds).toStrictEqual([secondAlert.id]);

    await resolveDeferredValue(second, buildAlertAcknowledgement(secondAlert.id), secondPending);
  });

  it('tracks a repeated pending acknowledgement id only once', async () => {
    const deferred = createDeferredValue<AlertAcknowledgement>();
    const alertId = buildAlertItem().id;
    mockAcknowledgeAlert.mockReturnValue(deferred.promise);
    const { result } = await renderLoadedOpenAlerts();

    const firstPending = beginHookRequest(() => result.current.acknowledge(alertId));
    const secondPending = beginHookRequest(() => result.current.acknowledge(alertId));

    expect(result.current.acknowledgingIds).toStrictEqual([alertId]);

    const bothPending = Promise.all([firstPending, secondPending]);
    await resolveDeferredValue(deferred, buildAlertAcknowledgement(alertId), bothPending);
  });

  it('aborts a pending load and stops its loading state when acknowledgement starts', async () => {
    const { result } = await renderLoadedOpenAlerts();
    const load = createDeferredValue<AlertsResponse>();
    const acknowledgement = createDeferredValue<AlertAcknowledgement>();
    mockFetchAlerts.mockReturnValueOnce(load.promise);
    mockAcknowledgeAlert.mockReturnValueOnce(acknowledgement.promise);
    const pendingLoad = beginHookRequest(result.current.refresh);
    const loadSignal = mockFetchAlerts.mock.calls[1][0].signal;

    const pendingAcknowledgement = beginHookRequest(
      () => result.current.acknowledge(buildAlertItem().id)
    );

    expect(loadSignal?.aborted).toBe(true);
    expect(result.current.loading).toBe(false);

    load.resolve(buildAlertsResponse());
    await resolveDeferredValue(
      acknowledgement,
      buildAlertAcknowledgement(buildAlertItem().id),
      Promise.all([pendingLoad, pendingAcknowledgement])
    );
  });

  it('clears the previous acknowledgement error while a retry is pending', async () => {
    mockAcknowledgeAlert.mockRejectedValueOnce(new AlertHookFailure());
    const { result } = await renderLoadedOpenAlerts();
    await act(() => result.current.acknowledge(buildAlertItem().id));
    const deferred = createDeferredValue<AlertAcknowledgement>();
    mockAcknowledgeAlert.mockReturnValueOnce(deferred.promise);

    const pending = beginHookRequest(() => result.current.acknowledge(buildAlertItem().id));

    expect(result.current.actionError).toBeNull();

    await resolveDeferredValue(
      deferred,
      buildAlertAcknowledgement(buildAlertItem().id),
      pending
    );
  });

  it('returns the alert-safe message when acknowledgement fails unexpectedly', async () => {
    mockAcknowledgeAlert.mockRejectedValueOnce(new AlertHookFailure());
    const { result } = await renderLoadedOpenAlerts();

    const outcome = await act(() => result.current.acknowledge(buildAlertItem().id));

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
