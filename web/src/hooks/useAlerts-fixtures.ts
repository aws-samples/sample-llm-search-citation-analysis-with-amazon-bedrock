import {
  expect, vi
} from 'vitest';
import {
  act, renderHook, waitFor
} from '@testing-library/react';
import type {
  AlertSettings, AlertsResponse, ContentChangeMarker
} from '../types';
import {
  buildAlertSettings,
  buildAlertsResponse,
  buildContentChangeMarker,
} from '../types/domain/alerts-fixtures';
import {
  useAlertSettings, useOpenAlerts
} from './useAlerts';
import type { useContentChanges } from './useAlerts';

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
