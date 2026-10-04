import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import { waitFor } from '@testing-library/react';
import type {
  AlertSettings, ContentChangeMarker
} from '../types';
import {
  buildAlertSettings,
  buildAlertTestNotificationResponse,
  buildAlertsResponse,
  buildContentChangeMarker,
} from '../types/domain/alerts-fixtures';
import * as alertApiMocks from './alertsApiMock-fixtures';
import { AlertHookFailure } from './alertHookErrors-fixtures';
import {
  ALERT_SETTINGS_UPDATE,
  CONTENT_CHANGE_REQUEST,
  beginContentChangeRecord,
  beginDeferredRefresh,
  beginSettingsSave,
  callAfterUnmount,
  completeAcknowledgement,
  completeSettingsSave,
  completeTestNotification,
  deferNextCall,
  renderContentChangesForGroup,
  renderLoadedAlertSettings,
  renderLoadedContentChanges,
  renderLoadedOpenAlerts,
  resolveDeferredValue,
  resolveSavedSettings,
} from './useAlerts-fixtures';

vi.mock('../api/alerts', () => import('./alertsApiMock-fixtures'));

beforeEach(alertApiMocks.prepareAlertHookTest);

describe('alert hook state resets', () => {
  it('clears an acknowledgement error when alerts refresh starts', async () => {
    alertApiMocks.acknowledgeAlert.mockRejectedValueOnce(new AlertHookFailure());
    const { result } = await renderLoadedOpenAlerts();
    await completeAcknowledgement(result.current);
    const refresh = beginDeferredRefresh(alertApiMocks.fetchAlerts, result.current, buildAlertsResponse());

    expect(result.current.actionError).toBeNull();

    await refresh.finish();
  });

  it('clears a completed test outcome when settings refresh starts', async () => {
    alertApiMocks.sendTestNotification.mockResolvedValueOnce(buildAlertTestNotificationResponse());
    const { result } = await renderLoadedAlertSettings();
    await completeTestNotification(result.current);
    const refresh = beginDeferredRefresh(alertApiMocks.fetchAlertSettings, result.current, buildAlertSettings());

    expect(result.current.testOutcome).toBeNull();

    await refresh.finish();
  });

  it('clears a completed save outcome while the next save is pending', async () => {
    const { result } = await renderLoadedAlertSettings();
    await completeSettingsSave(result.current);
    const response = deferNextCall<AlertSettings>(alertApiMocks.updateAlertSettings);

    const pending = beginSettingsSave(result.current);

    expect(result.current.saveOutcome).toBeNull();

    await resolveSavedSettings(response, pending);
  });

  it('clears a content-change load error when group selection is removed', async () => {
    alertApiMocks.fetchContentChanges.mockRejectedValueOnce(new AlertHookFailure());
    const {
      result, rerender
    } = renderContentChangesForGroup();
    await waitFor(() => expect(result.current.error).toBe('Failed to process alert request'));

    rerender({ selectedGroupId: '' });

    expect(result.current.error).toBeNull();
  });

  it('clears a failed record outcome while the next record is pending', async () => {
    alertApiMocks.createContentChange.mockRejectedValueOnce(new AlertHookFailure());
    const { result } = await renderLoadedContentChanges();
    await beginContentChangeRecord(result.current);
    const response = deferNextCall<ContentChangeMarker>(alertApiMocks.createContentChange);

    const pending = beginContentChangeRecord(result.current);

    expect(result.current.recordOutcome).toBeNull();

    await resolveDeferredValue(response, buildContentChangeMarker(), pending);
  });

  it('returns cancellation without saving when invoked after unmount', async () => {
    const outcome = await callAfterUnmount(
      renderLoadedAlertSettings,
      alertApiMocks.updateAlertSettings,
      (hook) => hook.saveSettings(ALERT_SETTINGS_UPDATE)
    );

    expect(outcome).toStrictEqual({
      success: false,
      message: 'Alert settings save cancelled.',
      warnings: [],
    });
    expect(alertApiMocks.updateAlertSettings).not.toHaveBeenCalled();
  });

  it('returns cancellation without recording when invoked after unmount', async () => {
    const outcome = await callAfterUnmount(
      renderLoadedContentChanges,
      alertApiMocks.createContentChange,
      (hook) => hook.recordContentChange(CONTENT_CHANGE_REQUEST)
    );

    expect(outcome).toStrictEqual({
      success: false,
      message: 'Content change recording cancelled.',
    });
    expect(alertApiMocks.createContentChange).not.toHaveBeenCalled();
  });
});
