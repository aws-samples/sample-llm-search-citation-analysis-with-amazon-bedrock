import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  act, renderHook, waitFor
} from '@testing-library/react';
import { ApiRequestError } from '../infrastructure';
import type {
  AlertSettings, AlertTestNotificationResponse, AlertsResponse
} from '../types';
import {
  buildAlertItem,
  buildAlertSettings,
  buildAlertTestNotificationResponse,
  buildAlertsResponse,
  buildContentChangeMarker,
  buildContentChangesResponse,
  settingsUpdateFrom,
} from '../types/domain/alerts-fixtures';
import {
  acknowledgeAlert as mockAcknowledgeAlert,
  createContentChange as mockCreateContentChange,
  fetchAlertSettings as mockFetchAlertSettings,
  fetchAlerts as mockFetchAlerts,
  fetchContentChanges as mockFetchContentChanges,
  prepareAlertHookTest,
  sendTestNotification as mockSendTestNotification,
  updateAlertSettings as mockUpdateAlertSettings,
} from './alertsApiMock-fixtures';
import {
  ALERT_SETTINGS_UPDATE,
  CONTENT_CHANGE_REQUEST,
  beginHookRequest,
  callAfterUnmount,
  completeAcknowledgement,
  completeTestNotification,
  createDeferredValue,
  deferNextCall,
  rejectDeferredValue,
  renderContentChangesForGroup,
  renderLoadedAlertSettings,
  renderLoadedContentChanges,
  renderLoadedOpenAlerts,
  renderSettingsWithTwoPendingTests,
  resolveDeferredValue,
  serveTwoOpenAlerts,
} from './useAlerts-fixtures';
import { deferNextTwoCalls } from '../test/fetchResponses';
import {
  useContentChanges, useOpenAlerts
} from './useAlerts';

vi.mock('../api/alerts', () => import('./alertsApiMock-fixtures'));

class AlertRequestAbortError extends Error {
  constructor() {
    super('Alert request aborted');
    this.name = 'AbortError';
  }
}

beforeEach(prepareAlertHookTest);

describe('useOpenAlerts', () => {
  it('loads open alerts once on mount with the default limit', async () => {
    const { result } = await renderLoadedOpenAlerts();

    expect(result.current.items).toStrictEqual(buildAlertsResponse().items);
    expect(result.current.count).toBe(1);
    expect(mockFetchAlerts).toHaveBeenCalledWith({
      status: 'open',
      limit: 20,
      signal: expect.any(AbortSignal),
    });
  });

  it('does not create a polling interval after loading alerts', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const { result } = renderHook(() => useOpenAlerts());

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(false);
    expect(setIntervalSpy.mock.calls).toStrictEqual([]);
  });

  it('aborts the active alert request when unmounted', async () => {
    mockFetchAlerts.mockReset();
    deferNextCall(mockFetchAlerts);
    const { unmount } = renderHook(() => useOpenAlerts());
    await waitFor(() => expect(mockFetchAlerts).toHaveBeenCalledTimes(1));

    unmount();

    expect(mockFetchAlerts.mock.calls[0][0].signal?.aborted).toBe(true);
  });

  it('finishes loading without an error when the alert request itself is aborted', async () => {
    mockFetchAlerts.mockRejectedValue(new AlertRequestAbortError());

    const { result } = await renderLoadedOpenAlerts();

    expect(result.current.error).toBeNull();
    expect(result.current.items).toStrictEqual([]);
  });

  it('ignores a stale alert response after manual refresh', async () => {
    const newerAlerts = buildAlertsResponse({
      items: [buildAlertItem({
        id: 'alert-2',
        message: 'Position moved outside the configured range.',
      })],
    });
    mockFetchAlerts.mockReset();
    const [staleResponse, currentResponse] = deferNextTwoCalls<AlertsResponse>(mockFetchAlerts);
    const { result } = renderHook(() => useOpenAlerts());
    await waitFor(() => expect(mockFetchAlerts).toHaveBeenCalledTimes(1));

    const pendingRefresh = beginHookRequest(result.current.refresh);
    expect(mockFetchAlerts.mock.calls[0][0].signal?.aborted).toBe(true);
    await resolveDeferredValue(currentResponse, newerAlerts, pendingRefresh);
    await resolveDeferredValue(staleResponse, buildAlertsResponse(), staleResponse.promise);

    expect(result.current.items).toStrictEqual(newerAlerts.items);
  });

  it('shows the alert-specific safe message when loading fails', async () => {
    mockFetchAlerts.mockRejectedValue(new ApiRequestError('HTTP 500', 500));

    const { result } = await renderLoadedOpenAlerts();

    expect(result.current.error).toBe('Failed to process alert request');
  });

  it('removes the acknowledged alert and decrements the open count', async () => {
    const [firstAlert, secondAlert] = serveTwoOpenAlerts({ type: 'position_loss' });
    const { result } = await renderLoadedOpenAlerts();

    const outcome = await completeAcknowledgement(result.current, firstAlert.id);

    expect(outcome).toStrictEqual({
      success: true,
      message: 'Alert acknowledged.',
    });
    expect(result.current.items).toStrictEqual([secondAlert]);
    expect(result.current.count).toBe(1);
  });

  it('keeps the alert and exposes the server message when acknowledgement fails', async () => {
    mockAcknowledgeAlert.mockRejectedValue(new ApiRequestError('HTTP 409', {
      statusCode: 409,
      responseMessage: 'Alert was already acknowledged.',
    }));
    const { result } = await renderLoadedOpenAlerts();

    const outcome = await completeAcknowledgement(result.current);

    expect(outcome).toStrictEqual({
      success: false,
      message: 'Alert was already acknowledged.',
    });
    expect(result.current.items).toStrictEqual(buildAlertsResponse().items);
    expect(result.current.actionError).toBe('Alert was already acknowledged.');
  });
});

describe('useAlertSettings', () => {
  it('loads alert settings on mount', async () => {
    const settings = buildAlertSettings();
    mockFetchAlertSettings.mockResolvedValue(settings);

    const { result } = await renderLoadedAlertSettings();

    expect(result.current.settings).toStrictEqual(settings);
    expect(mockFetchAlertSettings).toHaveBeenCalledWith(expect.any(AbortSignal));
  });

  it('uses the resolved server settings and warnings after save', async () => {
    const update = ALERT_SETTINGS_UPDATE;
    const savedSettings = buildAlertSettings({
      ...update,
      warnings: ['owner@example.com must confirm the subscription.'],
    });
    mockUpdateAlertSettings.mockResolvedValue(savedSettings);
    const { result } = await renderLoadedAlertSettings();

    const outcome = await act(() => result.current.saveSettings(update));

    expect(result.current.settings).toStrictEqual(savedSettings);
    expect(outcome).toStrictEqual({
      success: true,
      message: 'Alert settings saved.',
      warnings: ['owner@example.com must confirm the subscription.'],
    });
    expect(result.current.saveOutcome).toStrictEqual(outcome);
  });

  it('keeps the PUT response authoritative when refresh starts during save', async () => {
    const staleSettings = buildAlertSettings();
    const savedSettings = buildAlertSettings({ enabled: false });
    const update = settingsUpdateFrom(savedSettings);
    const deferredSave = deferNextCall<AlertSettings>(mockUpdateAlertSettings);
    const { result } = await renderLoadedAlertSettings();
    const deferredRefresh = deferNextCall<AlertSettings>(mockFetchAlertSettings);

    const pendingSave = beginHookRequest(() => result.current.saveSettings(update));
    const pendingRefresh = beginHookRequest(result.current.refresh);
    await resolveDeferredValue(deferredSave, savedSettings, pendingSave);

    expect(mockFetchAlertSettings.mock.calls[1][0]?.aborted).toBe(true);
    await resolveDeferredValue(deferredRefresh, staleSettings, pendingRefresh);
    expect(result.current.settings).toStrictEqual(savedSettings);
    expect(result.current.saveOutcome?.message).toBe('Alert settings saved.');
  });

  it('does not update settings after an in-flight save outlives unmount', async () => {
    const initialSettings = buildAlertSettings();
    const deferredSave = deferNextCall<AlertSettings>(mockUpdateAlertSettings);
    const {
      result, unmount
    } = await renderLoadedAlertSettings();

    const pendingSave = beginHookRequest(() => result.current.saveSettings({
      enabled: false,
      notification_emails: [],
      thresholds: initialSettings.thresholds,
    }));
    unmount();
    deferredSave.resolve(buildAlertSettings({ enabled: false }));
    await pendingSave;

    expect(result.current.settings).toStrictEqual(initialSettings);
  });

  it('returns the exact definitive client message when saving fails', async () => {
    mockUpdateAlertSettings.mockRejectedValue(new ApiRequestError('HTTP 400', {
      statusCode: 400,
      responseMessage: 'At least one threshold is required.',
    }));
    const { result } = await renderLoadedAlertSettings();

    const outcome = await act(() => result.current.saveSettings({
      enabled: true,
      notification_emails: [],
      thresholds: buildAlertSettings().thresholds,
    }));

    expect(outcome).toStrictEqual({
      success: false,
      message: 'At least one threshold is required.',
      warnings: [],
    });
    expect(result.current.saveOutcome).toStrictEqual(outcome);
  });

  it('sets testing while the test notification request is pending', async () => {
    const deferred = deferNextCall<AlertTestNotificationResponse>(mockSendTestNotification);
    const { result } = await renderLoadedAlertSettings();

    const pendingSend = beginHookRequest(result.current.sendTestNotification);

    expect(result.current.testing).toBe(true);
    expect(result.current.testOutcome).toBeNull();
    expect(mockSendTestNotification).toHaveBeenCalledWith(expect.any(AbortSignal));

    await resolveDeferredValue(deferred, buildAlertTestNotificationResponse(), pendingSend);
  });

  it('replaces the prior save outcome when test delivery is accepted', async () => {
    const { result } = await renderLoadedAlertSettings();
    const settings = buildAlertSettings();
    await act(() => result.current.saveSettings(settingsUpdateFrom(settings)));

    await completeTestNotification(result.current);

    expect(result.current.saveOutcome).toBeNull();
    expect(result.current.testOutcome).toStrictEqual({
      success: true,
      message: 'Test notification accepted for delivery.',
    });
  });

  it('clears the previous test outcome while a retry is pending', async () => {
    const { result } = await renderLoadedAlertSettings();
    await completeTestNotification(result.current);
    const retryResponse = deferNextCall<AlertTestNotificationResponse>(mockSendTestNotification);

    const pendingRetry = beginHookRequest(result.current.sendTestNotification);

    expect(result.current.testOutcome).toBeNull();
    await resolveDeferredValue(retryResponse, buildAlertTestNotificationResponse(), pendingRetry);
  });

  it.each([
    {
      name: 'stores the accepted outcome when the latest test request succeeds',
      response: () => mockSendTestNotification.mockResolvedValue(buildAlertTestNotificationResponse()),
      expected: {
        success: true,
        message: 'Test notification accepted for delivery.',
      },
    },
    {
      name: 'stores the definitive client message when the test request fails',
      response: () => mockSendTestNotification.mockRejectedValue(new ApiRequestError('HTTP 400', {
        statusCode: 400,
        responseMessage: 'Confirm an email subscription before testing delivery.',
      })),
      expected: {
        success: false,
        message: 'Confirm an email subscription before testing delivery.',
      },
    },
    {
      name: 'stores the alert-safe fallback when the test request fails',
      response: () => mockSendTestNotification.mockRejectedValue(new ApiRequestError('HTTP 500', 500)),
      expected: {
        success: false,
        message: 'Failed to process alert request',
      },
    },
  ])('$name', async ({
    response, expected
  }) => {
    response();
    const { result } = await renderLoadedAlertSettings();

    const outcome = await completeTestNotification(result.current);

    expect(outcome).toStrictEqual(expected);
    expect(result.current.testOutcome).toStrictEqual(outcome);
    expect(result.current.testing).toBe(false);
  });

  it('returns cancellation when a superseded test request aborts', async () => {
    const abortedResponse = createDeferredValue<AlertTestNotificationResponse>();
    mockSendTestNotification.mockImplementationOnce((signal) => {
      signal?.addEventListener('abort', () => {
        abortedResponse.reject(new AlertRequestAbortError());
      }, { once: true });
      return abortedResponse.promise;
    });
    const latestResponse = deferNextCall<AlertTestNotificationResponse>(mockSendTestNotification);
    const { result } = await renderLoadedAlertSettings();

    const abortedSend = beginHookRequest(result.current.sendTestNotification);
    const latestSend = beginHookRequest(result.current.sendTestNotification);
    const outcome = await abortedSend;
    await resolveDeferredValue(latestResponse, buildAlertTestNotificationResponse(), latestSend);

    expect(outcome).toStrictEqual({
      success: false,
      message: 'Test notification cancelled.',
    });
  });

  it('keeps the latest request pending when stale success arrives first', async () => {
    const {
      result, older, latest, olderSend, latestSend
    } = await renderSettingsWithTwoPendingTests();
    await resolveDeferredValue(older, buildAlertTestNotificationResponse(), olderSend);

    expect(result.current.testing).toBe(true);
    expect(result.current.testOutcome).toBeNull();

    await resolveDeferredValue(latest, buildAlertTestNotificationResponse(), latestSend);
  });

  it('preserves the latest outcome when an older test request settles last', async () => {
    const {
      result, older, latest, olderSend, olderSignal, latestSend
    } = await renderSettingsWithTwoPendingTests();
    await resolveDeferredValue(latest, buildAlertTestNotificationResponse(), latestSend);
    await rejectDeferredValue(older, new ApiRequestError('Older request failed', 500), olderSend);

    expect(olderSignal?.aborted).toBe(true);
    expect(result.current.testOutcome).toStrictEqual({
      success: true,
      message: 'Test notification accepted for delivery.',
    });
    expect(result.current.testing).toBe(false);
  });

  it('aborts an in-flight test notification when unmounted', async () => {
    const deferred = deferNextCall<AlertTestNotificationResponse>(mockSendTestNotification);
    const {
      result, unmount
    } = await renderLoadedAlertSettings();

    const pendingSend = beginHookRequest(result.current.sendTestNotification);
    const signal = mockSendTestNotification.mock.calls[0][0];
    unmount();
    deferred.resolve(buildAlertTestNotificationResponse());
    await pendingSend;

    expect(signal?.aborted).toBe(true);
    expect(result.current.testOutcome).toBeNull();
  });

  it('returns cancellation without a request when invoked after unmount', async () => {
    const outcome = await callAfterUnmount(
      renderLoadedAlertSettings,
      mockSendTestNotification,
      (hook) => hook.sendTestNotification()
    );

    expect(outcome).toStrictEqual({
      success: false,
      message: 'Test notification cancelled.',
    });
    expect(mockSendTestNotification.mock.calls).toStrictEqual([]);
  });
});

describe('useContentChanges', () => {
  it('does not request markers until a keyword group is selected', () => {
    const { result } = renderHook(() => useContentChanges(''));

    expect(result.current.loading).toBe(false);
    expect(result.current.latestMarker).toBeNull();
    expect(mockFetchContentChanges.mock.calls).toStrictEqual([]);
  });

  it('loads the latest marker for the selected group', async () => {
    const marker = buildContentChangeMarker();
    mockFetchContentChanges.mockResolvedValue(buildContentChangesResponse({ items: [marker] }));

    const { result } = await renderLoadedContentChanges();

    expect(result.current.latestMarker).toStrictEqual(marker);
    expect(mockFetchContentChanges).toHaveBeenCalledWith({
      groupId: 'group-north',
      limit: 1,
      signal: expect.any(AbortSignal),
    });
  });

  it('clears the previous marker when the next group request fails', async () => {
    const previousMarker = buildContentChangeMarker();
    mockFetchContentChanges
      .mockResolvedValueOnce(buildContentChangesResponse({ items: [previousMarker] }))
      .mockRejectedValueOnce(new ApiRequestError('HTTP 500', 500));
    const {
      result, rerender
    } = renderContentChangesForGroup();
    await waitFor(() => expect(result.current.latestMarker).toStrictEqual(previousMarker));

    rerender({ selectedGroupId: 'group-south' });

    await waitFor(() => expect(result.current.error).toBe('Failed to process alert request'));
    expect(result.current.latestMarker).toBeNull();
  });

  it('stores the marker returned after recording a content change', async () => {
    const marker = buildContentChangeMarker({ description: 'Published revised guidance' });
    const request = CONTENT_CHANGE_REQUEST;
    mockCreateContentChange.mockResolvedValue(marker);
    const { result } = await renderLoadedContentChanges();

    const outcome = await act(() => result.current.recordContentChange(request));

    expect(outcome).toStrictEqual({
      success: true,
      message: 'Content change recorded.',
    });
    expect(result.current.latestMarker).toStrictEqual(marker);
    expect(result.current.recordOutcome).toStrictEqual(outcome);
  });
});
