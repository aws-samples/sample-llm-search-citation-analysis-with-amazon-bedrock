import {
  expect, vi
} from 'vitest';
import {
  renderHook, waitFor
} from '@testing-library/react';
import type {
  AlertSettings, AlertsResponse, ContentChangeMarker
} from '../types';
import {
  buildAlertSettings,
  buildAlertsResponse,
  buildContentChangeMarker,
} from '../types/domain/alerts-fixtures';
import { useOpenAlerts } from './useAlerts';
import type {
  useAlertSettings, useContentChanges
} from './useAlerts';

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

export async function renderLoadedOpenAlerts() {
  const rendered = renderHook(() => useOpenAlerts());
  await waitFor(() => expect(rendered.result.current.loading).toBe(false));
  return rendered;
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
    refresh: vi.fn(),
    saveSettings: vi.fn().mockResolvedValue({
      success: true,
      message: 'Alert settings saved.',
      warnings: [],
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
