import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  expect, vi
} from 'vitest';
import {
  act, renderHook, waitFor
} from '@testing-library/react';
import type {
  AlertAcknowledgement,
  AlertSettings,
  AlertSettingsUpdate,
  AlertsResponse,
  ContentChangeMarker,
  CreateContentChangeRequest,
} from '../types';
import {
  buildAlertSettings,
  buildAlertsResponse,
  buildContentChangeMarker,
} from '../types/domain/alerts-fixtures';
import {
  useAlertSettings, useContentChanges, useOpenAlerts
} from './useAlerts';

export const ALERT_SETTINGS_UPDATE = {
  enabled: false,
  notification_emails: ['owner@example.com'],
  thresholds: {
    citation_rate_drop: 12,
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

export interface DeferredValue<TValue> {
  promise: Promise<TValue>;
  resolve: (resolvedValue: TValue) => void;
  reject: (reason: unknown) => void;
}

export function createDeferredValue<TValue>(): DeferredValue<TValue> {
  const settlers: Pick<DeferredValue<TValue>, 'resolve' | 'reject'> = {
    resolve: () => undefined,
    reject: () => undefined,
  };
  const promise = new Promise<TValue>((resolve, reject) => {
    settlers.resolve = resolve;
    settlers.reject = reject;
  });
  return {
    promise,
    ...settlers,
  };
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

async function renderLoadedHook<THookResult extends { loading: boolean }>(hook: () => THookResult) {
  const rendered = renderHook(hook);
  await waitFor(() => expect(rendered.result.current.loading).toBe(false));
  return rendered;
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
    refresh: vi.fn(),
    recordContentChange: vi.fn().mockResolvedValue({
      success: true,
      message: 'Content change recorded.',
    }),
    ...overrides,
  };
}
