import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  act, waitFor
} from '@testing-library/react';
import type {
  AlertSettings, AlertsResponse, ContentChangeMarker
} from '../types';
import {
  buildAlertItem,
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
  beginHookRequest,
  createDeferredValue,
  renderContentChangesForGroup,
  renderLoadedAlertSettings,
  renderLoadedContentChanges,
  renderLoadedOpenAlerts,
  resolveDeferredValue,
} from './useAlerts-fixtures';

vi.mock('../api/alerts', () => import('./alertsApiMock-fixtures'));

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(vi.fn());
  alertApiMocks.resetAlertsApiMocks();
});

describe('alert hook state resets', () => {
  it('clears an acknowledgement error when alerts refresh starts', async () => {
    alertApiMocks.acknowledgeAlert.mockRejectedValueOnce(new AlertHookFailure());
    const { result } = await renderLoadedOpenAlerts();
    await act(() => result.current.acknowledge(buildAlertItem().id));
    const response = createDeferredValue<AlertsResponse>();
    alertApiMocks.fetchAlerts.mockReturnValueOnce(response.promise);

    const pending = beginHookRequest(result.current.refresh);

    expect(result.current.actionError).toBeNull();

    await resolveDeferredValue(response, buildAlertsResponse(), pending);
  });

  it('clears a completed test outcome when settings refresh starts', async () => {
    alertApiMocks.sendTestNotification.mockResolvedValueOnce(buildAlertTestNotificationResponse());
    const { result } = await renderLoadedAlertSettings();
    await act(() => result.current.sendTestNotification());
    const response = createDeferredValue<AlertSettings>();
    alertApiMocks.fetchAlertSettings.mockReturnValueOnce(response.promise);

    const pending = beginHookRequest(result.current.refresh);

    expect(result.current.testOutcome).toBeNull();

    await resolveDeferredValue(response, buildAlertSettings(), pending);
  });

  it('clears a completed save outcome while the next save is pending', async () => {
    const { result } = await renderLoadedAlertSettings();
    await act(() => result.current.saveSettings(ALERT_SETTINGS_UPDATE));
    const response = createDeferredValue<AlertSettings>();
    alertApiMocks.updateAlertSettings.mockReturnValueOnce(response.promise);

    const pending = beginHookRequest(() => result.current.saveSettings(ALERT_SETTINGS_UPDATE));

    expect(result.current.saveOutcome).toBeNull();

    await resolveDeferredValue(
      response,
      buildAlertSettings(ALERT_SETTINGS_UPDATE),
      pending
    );
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
    const response = createDeferredValue<ContentChangeMarker>();
    alertApiMocks.createContentChange.mockReturnValueOnce(response.promise);

    const pending = beginContentChangeRecord(result.current);

    expect(result.current.recordOutcome).toBeNull();

    await resolveDeferredValue(response, buildContentChangeMarker(), pending);
  });

  it('returns cancellation without saving when invoked after unmount', async () => {
    const {
      result, unmount
    } = await renderLoadedAlertSettings();
    const saveAfterUnmount = result.current.saveSettings;
    alertApiMocks.updateAlertSettings.mockClear();
    unmount();

    const outcome = await saveAfterUnmount(ALERT_SETTINGS_UPDATE);

    expect(outcome).toStrictEqual({
      success: false,
      message: 'Alert settings save cancelled.',
      warnings: [],
    });
    expect(alertApiMocks.updateAlertSettings).not.toHaveBeenCalled();
  });

  it('returns cancellation without recording when invoked after unmount', async () => {
    const {
      result, unmount
    } = await renderLoadedContentChanges();
    const recordAfterUnmount = result.current.recordContentChange;
    alertApiMocks.createContentChange.mockClear();
    unmount();

    const outcome = await recordAfterUnmount(CONTENT_CHANGE_REQUEST);

    expect(outcome).toStrictEqual({
      success: false,
      message: 'Content change recording cancelled.',
    });
    expect(alertApiMocks.createContentChange).not.toHaveBeenCalled();
  });
});
