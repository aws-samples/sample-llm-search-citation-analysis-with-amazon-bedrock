import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  act, renderHook, waitFor
} from '@testing-library/react';
import { buildAlertItem } from '../types/domain/alerts-fixtures';
import { createMockJsonResponse } from '../test/fetchResponses';
import { useAlertList } from './useAlertList';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

import { mockAuthenticatedFetch } from '../test/infrastructureMock';

/** The first page of acknowledged alerts: one alert, a cursor to `alerts-2`, 2 alerts in all. */
function stubFirstAlertPage(): void {
  mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse({
    items: [buildAlertItem({ id: 'alert-1' })],
    count: 1,
    total: 2,
    next_token: 'alerts-2',
  }));
}

/** The last page: `alert-2`. */
function stubLastAlertPage(): void {
  mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse({
    items: [buildAlertItem({ id: 'alert-2' })],
    count: 1,
    total: 2,
    next_token: null,
  }));
}

async function renderAcknowledgedAlertsHook() {
  stubFirstAlertPage();
  const hook = renderHook(() => useAlertList('acknowledged'));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

describe('useAlertList', () => {
  beforeEach(() => {
    mockAuthenticatedFetch.mockReset();
  });

  it('reads the first page of the status', async () => {
    await renderAcknowledgedAlertsHook();

    const { searchParams } = new URL(String(mockAuthenticatedFetch.mock.calls[0][0]));
    expect([searchParams.get('status'), searchParams.get('next_token')]).toStrictEqual(['acknowledged', null]);
  });

  it('appends the next page of alerts', async () => {
    const { result } = await renderAcknowledgedAlertsHook();
    stubLastAlertPage();

    await act(() => result.current.loadMore?.() ?? Promise.resolve());

    expect(result.current.items.map((item) => item.id)).toStrictEqual(['alert-1', 'alert-2']);
  });

  it('asks for the next page with the cursor', async () => {
    const { result } = await renderAcknowledgedAlertsHook();
    stubLastAlertPage();

    await act(() => result.current.loadMore?.() ?? Promise.resolve());

    expect(new URL(String(mockAuthenticatedFetch.mock.calls[1][0])).searchParams.get('next_token')).toBe('alerts-2');
  });

  it('offers no further page after the last', async () => {
    const { result } = await renderAcknowledgedAlertsHook();
    stubLastAlertPage();

    await act(() => result.current.loadMore?.() ?? Promise.resolve());

    expect(result.current.loadMore).toBeUndefined();
  });
});
