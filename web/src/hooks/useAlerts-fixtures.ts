import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { vi } from 'vitest';
import {
  act, renderHook, type RenderHookResult
} from '@testing-library/react';
import {
  renderLoadedHook, waitForLoaded
} from '../test/loadedHook';
import type {
  AlertAcknowledgement,
  AlertItem,
  AlertSettings,
  AlertSettingsUpdate,
  AlertTestNotificationResponse,
  AlertsResponse,
  ContentChangeMarker,
  CreateContentChangeRequest,
} from '../types';
import {
  createDeferredValue, deferNextTwoCalls, type DeferredValue
} from '../test/fetchResponses';
import {
  buildAlertItem,
  buildAlertSettings,
  buildAlertsResponse,
  buildContentChangeMarker,
} from '../types/domain/alerts-fixtures';
import {
  fetchAlerts, sendTestNotification
} from './alertsApiMock-fixtures';
import {
  useAlertSettings, useContentChanges, useOpenAlerts
} from './useAlerts';

export const ALERT_SETTINGS_UPDATE = {
  enabled: false,
  notification_emails: ['owner@example.com'],
  thresholds: {
    mention_rate_drop: 12,
    position_loss: 4,
    competitor_top_n: 3,
    improvement_after_content_change: 9,
  },
} satisfies AlertSettingsUpdate;

export const CONTENT_CHANGE_REQUEST = {
  group_id: 'group-north',
  description: 'Published revised guidance',
  url: 'https://example.com/guidance',
} satisfies CreateContentChangeRequest;

export {
  createDeferredValue, type DeferredValue
} from '../test/fetchResponses';

/** Queues one hand-settled result for the next call of `mock`. */
export function deferNextCall<TValue>(
  mock: { mockReturnValueOnce: (value: Promise<TValue>) => unknown }
): DeferredValue<TValue> {
  const deferred = createDeferredValue<TValue>();
  mock.mockReturnValueOnce(deferred.promise);
  return deferred;
}

/**
 * Starts `hook.refresh` with the next `loadMock` response held back; `finish`
 * releases it with `loadedValue` and waits for the refresh to settle.
 */
export function beginDeferredRefresh<TValue>(
  loadMock: { mockReturnValueOnce: (value: Promise<TValue>) => unknown },
  hook: { refresh: () => Promise<void> },
  loadedValue: TValue
) {
  const response = deferNextCall(loadMock);
  const pending = beginHookRequest(hook.refresh);
  return { finish: () => resolveDeferredValue(response, loadedValue, pending) };
}

export async function resolveDeferredValue<TValue>(
  deferred: DeferredValue<TValue>,
  value: TValue,
  pending: Promise<unknown>
): Promise<void> {
  await act(async () => {
    deferred.resolve(value);
    await pending;
  });
}

export async function rejectDeferredValue<TValue>(
  deferred: DeferredValue<TValue>,
  reason: unknown,
  pending: Promise<unknown>
): Promise<void> {
  await act(async () => {
    deferred.reject(reason);
    await pending;
  });
}

export function resolveSavedSettings(
  deferred: DeferredValue<AlertSettings>,
  pending: Promise<unknown>
): Promise<void> {
  return resolveDeferredValue(
    deferred,
    buildAlertSettings(ALERT_SETTINGS_UPDATE),
    pending
  );
}

export function renderLoadedOpenAlerts() {
  return renderLoadedHook(() => useOpenAlerts());
}

export function renderLoadedAlertSettings() {
  return renderLoadedHook(() => useAlertSettings());
}

export function renderLoadedContentChanges(groupId = 'group-north') {
  return renderLoadedHook(() => useContentChanges(groupId));
}

/** Renders a loaded hook, unmounts it, then invokes one of its actions through the stale hook value. */
export async function callAfterUnmount<THook, TOutcome>(
  renderLoaded: () => Promise<RenderHookResult<THook, unknown>>,
  apiMock: { mockClear: () => unknown },
  call: (hook: THook) => Promise<TOutcome>
): Promise<TOutcome> {
  const {
    result, unmount
  } = await renderLoaded();
  const hookBeforeUnmount = result.current;
  apiMock.mockClear();
  unmount();
  return call(hookBeforeUnmount);
}

export function renderContentChangesForGroup(groupId = 'group-north') {
  return renderHook(
    ({ selectedGroupId }) => useContentChanges(selectedGroupId),
    { initialProps: { selectedGroupId: groupId } }
  );
}

export function beginContentChangeRecord(
  hook: ReturnType<typeof useContentChanges>,
  request: CreateContentChangeRequest = CONTENT_CHANGE_REQUEST
) {
  return beginHookRequest(() => hook.recordContentChange(request));
}

/** Starts a record for group-north, then switches the selection to group-south and waits for its load. */
export async function beginRecordThenSwitchGroup() {
  const {
    result, rerender
  } = renderContentChangesForGroup();
  await waitForLoaded(result);
  const pendingRecord = beginContentChangeRecord(result.current);
  rerender({ selectedGroupId: 'group-south' });
  await waitForLoaded(result);
  return {
    result,
    pendingRecord,
  };
}

export function beginAlertAcknowledgement(
  hook: ReturnType<typeof useOpenAlerts>,
  alertId: string = buildAlertItem().id
) {
  return beginHookRequest(() => hook.acknowledge(alertId));
}

export function resolveAcknowledgement(
  deferred: DeferredValue<AlertAcknowledgement>,
  alertId: string,
  pending: Promise<unknown>
): Promise<void> {
  return resolveDeferredValue(deferred, buildAlertAcknowledgement(alertId), pending);
}

export function beginSettingsSave(hook: ReturnType<typeof useAlertSettings>) {
  return beginHookRequest(() => hook.saveSettings(ALERT_SETTINGS_UPDATE));
}

export function completeSettingsSave(hook: ReturnType<typeof useAlertSettings>) {
  return act(() => hook.saveSettings(ALERT_SETTINGS_UPDATE));
}

export function completeTestNotification(hook: ReturnType<typeof useAlertSettings>) {
  return act(() => hook.sendTestNotification());
}

export function completeAcknowledgement(
  hook: ReturnType<typeof useOpenAlerts>,
  alertId: string = buildAlertItem().id
) {
  return act(() => hook.acknowledge(alertId));
}

/** Serves two open alerts (the second with `secondOverrides`) from the alerts API. */
export function serveTwoOpenAlerts(secondOverrides: Partial<AlertItem> = {}): [AlertItem, AlertItem] {
  const firstAlert = buildAlertItem();
  const secondAlert = buildAlertItem({
    id: 'alert-2',
    ...secondOverrides,
  });
  fetchAlerts.mockResolvedValue(buildAlertsResponse({
    items: [firstAlert, secondAlert],
    count: 2,
  }));
  return [firstAlert, secondAlert];
}

/** Loaded alert settings with two test notifications in flight, the older one first. */
export async function renderSettingsWithTwoPendingTests() {
  const [older, latest] = deferNextTwoCalls<AlertTestNotificationResponse>(sendTestNotification);
  const { result } = await renderLoadedAlertSettings();
  const olderSend = beginHookRequest(result.current.sendTestNotification);
  const olderSignal = sendTestNotification.mock.calls[0][0];
  const latestSend = beginHookRequest(result.current.sendTestNotification);
  return {
    result,
    older,
    latest,
    olderSend,
    olderSignal,
    latestSend,
  };
}

/** Loaded alert settings with one test notification left in flight. */
export async function renderSettingsWithPendingTest() {
  const testResponse = deferNextCall(sendTestNotification);
  const { result } = await renderLoadedAlertSettings();
  const pendingTest = beginHookRequest(result.current.sendTestNotification);
  return {
    result,
    testResponse,
    pendingTest,
    testSignal: sendTestNotification.mock.calls[0][0],
  };
}

export function buildAlertAcknowledgement(id: string): AlertAcknowledgement {
  return {
    success: true,
    id,
    status: 'acknowledged',
  };
}

function openAlertsInitialStateProbe() {
  const state = useOpenAlerts();
  return `loading:${String(state.loading)};acknowledging:${state.acknowledgingIds.join(',')}`;
}

function alertSettingsInitialStateProbe() {
  const state = useAlertSettings();
  return `loading:${String(state.loading)};saving:${String(state.saving)};testing:${String(state.testing)}`;
}

function contentChangesInitialStateProbe() {
  const state = useContentChanges('');
  return `loading:${String(state.loading)};recording:${String(state.recording)}`;
}

export function renderOpenAlertsInitialState(): string {
  return renderToStaticMarkup(createElement(openAlertsInitialStateProbe));
}

export function renderAlertSettingsInitialState(): string {
  return renderToStaticMarkup(createElement(alertSettingsInitialStateProbe));
}

export function renderContentChangesInitialState(): string {
  return renderToStaticMarkup(createElement(contentChangesInitialStateProbe));
}

class AlertHookFixtureError extends Error {
  constructor() {
    super('Alert hook action did not start synchronously');
    this.name = 'AlertHookFixtureError';
  }
}

export function beginHookRequest<TRequestResult>(
  request: () => Promise<TRequestResult>
): Promise<TRequestResult> {
  const pending: { request?: Promise<TRequestResult> } = {};
  act(() => {
    pending.request = request();
  });
  if (pending.request === undefined) throw new AlertHookFixtureError();
  return pending.request;
}

export function buildOpenAlertsHookResult(
  overrides: Partial<ReturnType<typeof useOpenAlerts>> = {}
): ReturnType<typeof useOpenAlerts> {
  const response: AlertsResponse = buildAlertsResponse();
  return {
    items: response.items,
    count: response.count,
    loading: false,
    error: null,
    actionError: null,
    acknowledgingIds: [],
    refresh: vi.fn(),
    acknowledge: vi.fn().mockResolvedValue({
      success: true,
      message: 'Alert acknowledged.',
    }),
    ...overrides,
  };
}

export function buildAlertSettingsHookResult(
  overrides: Partial<ReturnType<typeof useAlertSettings>> = {}
): ReturnType<typeof useAlertSettings> {
  const settings: AlertSettings = buildAlertSettings();
  return {
    settings,
    loading: false,
    error: null,
    saving: false,
    saveOutcome: null,
    testing: false,
    testOutcome: null,
    refresh: vi.fn(),
    saveSettings: vi.fn().mockResolvedValue({
      success: true,
      message: 'Alert settings saved.',
      warnings: [],
    }),
    sendTestNotification: vi.fn().mockResolvedValue({
      success: true,
      message: 'Test notification accepted for delivery.',
    }),
    ...overrides,
  };
}

export function buildContentChangesHookResult(
  overrides: Partial<ReturnType<typeof useContentChanges>> = {}
): ReturnType<typeof useContentChanges> {
  const latestMarker: ContentChangeMarker = buildContentChangeMarker();
  return {
    latestMarker,
    loading: false,
    error: null,
    recording: false,
    recordOutcome: null,
    recordContentChange: vi.fn().mockResolvedValue({
      success: true,
      message: 'Content change recorded.',
    }),
    ...overrides,
  };
}
