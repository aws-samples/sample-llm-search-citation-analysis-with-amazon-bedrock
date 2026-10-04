import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import { renderHook } from '@testing-library/react';
import { ApiRequestError } from '../infrastructure';
import type {
  AlertSettings, AlertTestNotificationResponse
} from '../types';
import {
  buildAlertSettings,
  buildAlertTestNotificationResponse,
} from '../types/domain/alerts-fixtures';
import {
  fetchAlertSettings as mockFetchAlertSettings,
  prepareAlertHookTest,
  sendTestNotification as mockSendTestNotification,
  updateAlertSettings as mockUpdateAlertSettings,
} from './alertsApiMock-fixtures';
import {
  AlertHookAbortError, AlertHookFailure
} from './alertHookErrors-fixtures';
import {
  ALERT_SETTINGS_UPDATE,
  beginDeferredRefresh,
  beginHookRequest,
  beginSettingsSave,
  completeSettingsSave,
  completeTestNotification,
  deferNextCall,
  renderLoadedAlertSettings,
  renderSettingsWithPendingTest,
  resolveDeferredValue,
  resolveSavedSettings,
} from './useAlerts-fixtures';
import { useAlertSettings } from './useAlerts';

vi.mock('../api/alerts', () => import('./alertsApiMock-fixtures'));

beforeEach(prepareAlertHookTest);

describe('useAlertSettings lifecycle', () => {
  it('starts loading without save or test activity while settings are pending', () => {
    deferNextCall(mockFetchAlertSettings);

    const { result } = renderHook(() => useAlertSettings());

    expect({
      settings: result.current.settings,
      loading: result.current.loading,
      saving: result.current.saving,
      testing: result.current.testing,
      saveOutcome: result.current.saveOutcome,
      testOutcome: result.current.testOutcome,
    }).toStrictEqual({
      settings: null,
      loading: true,
      saving: false,
      testing: false,
      saveOutcome: null,
      testOutcome: null,
    });
  });

  it('aborts a pending test and clears test state when settings refresh starts', async () => {
    const {
      result, testResponse, pendingTest, testSignal
    } = await renderSettingsWithPendingTest();
    const refreshResponse = deferNextCall<AlertSettings>(mockFetchAlertSettings);

    const pendingRefresh = beginHookRequest(result.current.refresh);

    expect(testSignal?.aborted).toBe(true);
    expect(result.current.testing).toBe(false);
    expect(result.current.testOutcome).toBeNull();

    testResponse.reject(new AlertHookAbortError());
    await resolveDeferredValue(
      refreshResponse,
      buildAlertSettings(),
      Promise.all([pendingTest, pendingRefresh])
    );
  });

  it('clears the previous save outcome when settings refresh starts', async () => {
    const { result } = await renderLoadedAlertSettings();
    await completeSettingsSave(result.current);
    const refresh = beginDeferredRefresh(mockFetchAlertSettings, result.current, buildAlertSettings());

    expect(result.current.saveOutcome).toBeNull();

    await refresh.finish();
  });

  it('does not abort a completed test request when another test starts', async () => {
    const { result } = await renderLoadedAlertSettings();
    await completeTestNotification(result.current);
    const completedSignal = mockSendTestNotification.mock.calls[0][0];
    const nextResponse = deferNextCall<AlertTestNotificationResponse>(mockSendTestNotification);

    const pending = beginHookRequest(result.current.sendTestNotification);

    expect(completedSignal?.aborted).toBe(false);

    await resolveDeferredValue(nextResponse, buildAlertTestNotificationResponse(), pending);
  });

  it('aborts a pending settings load when saving starts', async () => {
    const { result } = await renderLoadedAlertSettings();
    const refreshResponse = deferNextCall<AlertSettings>(mockFetchAlertSettings);
    const saveResponse = deferNextCall<AlertSettings>(mockUpdateAlertSettings);
    const pendingRefresh = beginHookRequest(result.current.refresh);
    const refreshSignal = mockFetchAlertSettings.mock.calls[1][0];

    const pendingSave = beginSettingsSave(result.current);

    expect(refreshSignal?.aborted).toBe(true);
    expect(result.current.loading).toBe(false);
    expect(result.current.saving).toBe(true);

    refreshResponse.resolve(buildAlertSettings());
    await resolveSavedSettings(saveResponse, Promise.all([pendingRefresh, pendingSave]));
  });

  it('aborts a pending test request when saving starts', async () => {
    const saveResponse = deferNextCall<AlertSettings>(mockUpdateAlertSettings);
    const {
      result, testResponse, pendingTest, testSignal
    } = await renderSettingsWithPendingTest();

    const pendingSave = beginSettingsSave(result.current);

    expect(testSignal?.aborted).toBe(true);
    expect(result.current.testing).toBe(false);

    testResponse.reject(new AlertHookAbortError());
    await resolveSavedSettings(saveResponse, Promise.all([pendingTest, pendingSave]));
  });

  it('clears prior outcomes while a save request is pending', async () => {
    const { result } = await renderLoadedAlertSettings();
    await completeTestNotification(result.current);
    const saveResponse = deferNextCall<AlertSettings>(mockUpdateAlertSettings);

    const pendingSave = beginSettingsSave(result.current);

    expect(result.current.saving).toBe(true);
    expect(result.current.testing).toBe(false);
    expect(result.current.saveOutcome).toBeNull();
    expect(result.current.testOutcome).toBeNull();

    await resolveSavedSettings(saveResponse, pendingSave);
  });

  it('returns no warnings when saved settings omit warnings', async () => {
    const savedSettings = buildAlertSettings({
      ...ALERT_SETTINGS_UPDATE,
      warnings: undefined,
    });
    mockUpdateAlertSettings.mockResolvedValueOnce(savedSettings);
    const { result } = await renderLoadedAlertSettings();

    const outcome = await completeSettingsSave(result.current);

    expect(outcome.warnings).toStrictEqual([]);
  });

  it('clears a settings load error after a successful save', async () => {
    mockFetchAlertSettings.mockRejectedValueOnce(new ApiRequestError('HTTP 500', 500));
    const { result } = await renderLoadedAlertSettings();
    const savedSettings = buildAlertSettings(ALERT_SETTINGS_UPDATE);
    mockUpdateAlertSettings.mockResolvedValueOnce(savedSettings);

    await completeSettingsSave(result.current);

    expect(result.current.error).toBeNull();
    expect(result.current.settings).toStrictEqual(savedSettings);
  });

  it('returns the alert-safe message when saving fails unexpectedly', async () => {
    mockUpdateAlertSettings.mockRejectedValueOnce(new AlertHookFailure());
    const { result } = await renderLoadedAlertSettings();

    const outcome = await completeSettingsSave(result.current);

    expect(outcome).toStrictEqual({
      success: false,
      message: 'Failed to process alert request',
      warnings: [],
    });
    expect(result.current.saveOutcome).toStrictEqual(outcome);
    expect(result.current.saving).toBe(false);
  });
});
