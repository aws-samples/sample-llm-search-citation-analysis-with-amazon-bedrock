import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  act, renderHook, waitFor
} from '@testing-library/react';
import { ApiRequestError } from '../infrastructure';
import type {
  AlertSettings, AlertsResponse
} from '../types';
import {
  buildAlertItem,
  buildAlertSettings,
  buildAlertsResponse,
  buildContentChangeMarker,
  buildContentChangesResponse,
} from '../types/domain/alerts-fixtures';
import {
  createDeferredValue, renderLoadedOpenAlerts
} from './useAlerts-fixtures';
import {
  useAlertSettings, useContentChanges, useOpenAlerts
} from './useAlerts';

vi.mock('../api/alerts', () => ({
  acknowledgeAlert: vi.fn(),
  createContentChange: vi.fn(),
  fetchAlerts: vi.fn(),
  fetchAlertSettings: vi.fn(),
  fetchContentChanges: vi.fn(),
  updateAlertSettings: vi.fn(),
}));

import {
  acknowledgeAlert,
  createContentChange,
  fetchAlerts,
  fetchAlertSettings,
  fetchContentChanges,
  updateAlertSettings,
} from '../api/alerts';

const mockAcknowledgeAlert = vi.mocked(acknowledgeAlert);
const mockCreateContentChange = vi.mocked(createContentChange);
const mockFetchAlerts = vi.mocked(fetchAlerts);
const mockFetchAlertSettings = vi.mocked(fetchAlertSettings);
const mockFetchContentChanges = vi.mocked(fetchContentChanges);
const mockUpdateAlertSettings = vi.mocked(updateAlertSettings);

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(vi.fn());
  mockFetchAlerts.mockReset().mockResolvedValue(buildAlertsResponse());
  mockAcknowledgeAlert.mockReset().mockResolvedValue({
    success: true,
    id: 'alert-d9c3a09f6c91aeb393b663030c383310',
    status: 'acknowledged',
  });
  mockFetchAlertSettings.mockReset().mockResolvedValue(buildAlertSettings());
  mockUpdateAlertSettings.mockReset().mockResolvedValue(buildAlertSettings());
  mockFetchContentChanges.mockReset().mockResolvedValue(buildContentChangesResponse());
  mockCreateContentChange.mockReset().mockResolvedValue(buildContentChangeMarker());
});

describe('useOpenAlerts', () => {
  it('loads open alerts once on mount with the default limit', async () => {
    const { result } = renderHook(() => useOpenAlerts());

    await waitFor(() => expect(result.current.loading).toBe(false));

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
    const deferred = createDeferredValue<AlertsResponse>();
    mockFetchAlerts.mockReset().mockReturnValue(deferred.promise);
    const { unmount } = renderHook(() => useOpenAlerts());
    await waitFor(() => expect(mockFetchAlerts).toHaveBeenCalledTimes(1));

    unmount();

    expect(mockFetchAlerts.mock.calls[0][0].signal?.aborted).toBe(true);
  });

  it('ignores a stale alert response after manual refresh', async () => {
    const staleResponse = createDeferredValue<AlertsResponse>();
    const currentResponse = createDeferredValue<AlertsResponse>();
    const newerAlerts = buildAlertsResponse({
      items: [buildAlertItem({
        id: 'alert-2',
        message: 'Position moved outside the configured range.',
      })],
    });
    mockFetchAlerts
      .mockReset()
      .mockReturnValueOnce(staleResponse.promise)
      .mockReturnValueOnce(currentResponse.promise);
    const { result } = renderHook(() => useOpenAlerts());
    await waitFor(() => expect(mockFetchAlerts).toHaveBeenCalledTimes(1));

    const pendingRefreshes: Promise<void>[] = [];
    act(() => {
      pendingRefreshes.push(result.current.refresh());
    });
    expect(mockFetchAlerts.mock.calls[0][0].signal?.aborted).toBe(true);
    await act(async () => {
      currentResponse.resolve(newerAlerts);
      await pendingRefreshes[0];
    });
    await act(async () => {
      staleResponse.resolve(buildAlertsResponse());
      await staleResponse.promise;
    });

    expect(result.current.items).toStrictEqual(newerAlerts.items);
  });

  it('shows the alert-specific safe message when loading fails', async () => {
    mockFetchAlerts.mockRejectedValue(new ApiRequestError('HTTP 500', 500));

    const { result } = renderHook(() => useOpenAlerts());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Failed to process alert request');
  });

  it('removes the acknowledged alert and decrements the open count', async () => {
    const firstAlert = buildAlertItem();
    const secondAlert = buildAlertItem({
      id: 'alert-2',
      type: 'position_loss',
    });
    mockFetchAlerts.mockResolvedValue(buildAlertsResponse({
      items: [firstAlert, secondAlert],
      count: 2,
    }));
    const { result } = await renderLoadedOpenAlerts();

    const outcome = await act(() => result.current.acknowledge(firstAlert.id));

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

    const outcome = await act(() => result.current.acknowledge(buildAlertItem().id));

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

    const { result } = renderHook(() => useAlertSettings());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.settings).toStrictEqual(settings);
    expect(mockFetchAlertSettings).toHaveBeenCalledWith(expect.any(AbortSignal));
  });

  it('uses the resolved server settings and warnings after save', async () => {
    const update = {
      enabled: false,
      notification_emails: ['owner@example.com'],
      thresholds: {
        citation_rate_drop: 12,
        position_loss: 4,
        competitor_top_n: 3,
        improvement_after_content_change: 9,
      },
    };
    const savedSettings = buildAlertSettings({
      ...update,
      warnings: ['owner@example.com must confirm the subscription.'],
    });
    mockUpdateAlertSettings.mockResolvedValue(savedSettings);
    const { result } = renderHook(() => useAlertSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

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
    const deferredSave = createDeferredValue<AlertSettings>();
    const deferredRefresh = createDeferredValue<AlertSettings>();
    const staleSettings = buildAlertSettings();
    const savedSettings = buildAlertSettings({ enabled: false });
    const update = {
      enabled: savedSettings.enabled,
      notification_emails: savedSettings.notification_emails,
      thresholds: savedSettings.thresholds,
    };
    mockUpdateAlertSettings.mockReturnValue(deferredSave.promise);
    const { result } = renderHook(() => useAlertSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    mockFetchAlertSettings.mockReturnValueOnce(deferredRefresh.promise);

    const pendingSaves: Promise<unknown>[] = [];
    const pendingRefreshes: Promise<void>[] = [];
    act(() => {
      pendingSaves.push(result.current.saveSettings(update));
    });
    act(() => {
      pendingRefreshes.push(result.current.refresh());
    });
    await act(async () => {
      deferredSave.resolve(savedSettings);
      await pendingSaves[0];
    });

    expect(mockFetchAlertSettings.mock.calls[1][0]?.aborted).toBe(true);
    await act(async () => {
      deferredRefresh.resolve(staleSettings);
      await pendingRefreshes[0];
    });
    expect(result.current.settings).toStrictEqual(savedSettings);
    expect(result.current.saveOutcome?.message).toBe('Alert settings saved.');
  });

  it('does not update settings after an in-flight save outlives unmount', async () => {
    const initialSettings = buildAlertSettings();
    const deferredSave = createDeferredValue<AlertSettings>();
    mockUpdateAlertSettings.mockReturnValue(deferredSave.promise);
    const {
      result, unmount
    } = renderHook(() => useAlertSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const pendingSaves: Promise<unknown>[] = [];
    act(() => {
      pendingSaves.push(result.current.saveSettings({
        enabled: false,
        notification_emails: [],
        thresholds: initialSettings.thresholds,
      }));
    });
    unmount();
    deferredSave.resolve(buildAlertSettings({ enabled: false }));
    await pendingSaves[0];

    expect(result.current.settings).toStrictEqual(initialSettings);
  });

  it('returns the exact definitive client message when saving fails', async () => {
    mockUpdateAlertSettings.mockRejectedValue(new ApiRequestError('HTTP 400', {
      statusCode: 400,
      responseMessage: 'At least one threshold is required.',
    }));
    const { result } = renderHook(() => useAlertSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

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

    const { result } = renderHook(() => useContentChanges('group-north'));

    await waitFor(() => expect(result.current.loading).toBe(false));
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
    } = renderHook(
      ({ groupId }) => useContentChanges(groupId),
      { initialProps: { groupId: 'group-north' } }
    );
    await waitFor(() => expect(result.current.latestMarker).toStrictEqual(previousMarker));

    rerender({ groupId: 'group-south' });

    await waitFor(() => expect(result.current.error).toBe('Failed to process alert request'));
    expect(result.current.latestMarker).toBeNull();
  });

  it('stores the marker returned after recording a content change', async () => {
    const marker = buildContentChangeMarker({ description: 'Published revised guidance' });
    const request = {
      group_id: 'group-north',
      description: 'Published revised guidance',
      url: 'https://example.com/guidance',
    };
    mockCreateContentChange.mockResolvedValue(marker);
    const { result } = renderHook(() => useContentChanges('group-north'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const outcome = await act(() => result.current.recordContentChange(request));

    expect(outcome).toStrictEqual({
      success: true,
      message: 'Content change recorded.',
    });
    expect(result.current.latestMarker).toStrictEqual(marker);
    expect(result.current.recordOutcome).toStrictEqual(outcome);
  });
});
