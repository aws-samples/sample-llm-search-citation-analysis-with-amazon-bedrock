import {
  afterEach, beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  act, renderHook, waitFor
} from '@testing-library/react';
import {
  mockDeleteExport, mockFetchDownloadUrl, mockListExports, mockMarkExportSeen, mockStartExport
} from '../test/exportsApiMock';
import { buildExportSummary } from '../types/domain/exports-fixtures';
import {
  EXPORT_POLL_MS, useExports, useExportsCenter
} from './useExports';

vi.mock('../api/exports', () => import('../test/exportsApiMock'));

const RUNNING = buildExportSummary({ status: 'running' });
const READY = buildExportSummary({ status: 'ready' });

describe('useExportsCenter polling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('re-reads the list every 5 s while an export is running', async () => {
    mockListExports.mockResolvedValue({ exports: [RUNNING] });
    renderHook(() => useExportsCenter());
    await act(() => vi.advanceTimersByTimeAsync(0));

    await act(() => vi.advanceTimersByTimeAsync(EXPORT_POLL_MS));
    await act(() => vi.advanceTimersByTimeAsync(EXPORT_POLL_MS));

    expect(mockListExports).toHaveBeenCalledTimes(3);
  });

  it('stops polling once no export is queued or running', async () => {
    mockListExports.mockResolvedValueOnce({ exports: [RUNNING] }).mockResolvedValue({ exports: [READY] });
    renderHook(() => useExportsCenter());
    await act(() => vi.advanceTimersByTimeAsync(0));

    await act(() => vi.advanceTimersByTimeAsync(EXPORT_POLL_MS));
    await act(() => vi.advanceTimersByTimeAsync(EXPORT_POLL_MS));
    await act(() => vi.advanceTimersByTimeAsync(EXPORT_POLL_MS));

    expect(mockListExports).toHaveBeenCalledTimes(2);
  });

  it('does not poll when every export is finished', async () => {
    mockListExports.mockResolvedValue({ exports: [READY] });
    renderHook(() => useExportsCenter());
    await act(() => vi.advanceTimersByTimeAsync(EXPORT_POLL_MS * 3));

    expect(mockListExports).toHaveBeenCalledTimes(1);
  });

  it('toasts that a running export is ready when a poll sees it finished', async () => {
    mockListExports.mockResolvedValueOnce({ exports: [RUNNING] }).mockResolvedValue({ exports: [READY] });
    const { result } = renderHook(() => useExportsCenter());
    await act(() => vi.advanceTimersByTimeAsync(0));

    await act(() => vi.advanceTimersByTimeAsync(EXPORT_POLL_MS));

    expect(result.current.toasts.map((toast) => [toast.tone, toast.message])).toStrictEqual([['success', 'Citations export is ready']]);
  });

  it('shows a browser notification when the user allowed them', async () => {
    const notification = vi.fn();
    vi.stubGlobal('Notification', Object.assign(notification, { permission: 'granted' }));
    mockListExports.mockResolvedValueOnce({ exports: [RUNNING] }).mockResolvedValue({ exports: [READY] });
    renderHook(() => useExportsCenter());
    await act(() => vi.advanceTimersByTimeAsync(0));

    await act(() => vi.advanceTimersByTimeAsync(EXPORT_POLL_MS));

    expect(notification).toHaveBeenCalledWith('Citations export is ready', {
      body: 'citations-group-coruna.xlsx',
      tag: 'exp-coruna',
    });
    vi.unstubAllGlobals();
  });
});

describe('useExportsCenter actions', () => {
  it('counts the finished exports the user has not seen', async () => {
    mockListExports.mockResolvedValue({
      exports: [READY, buildExportSummary({
        export_id: 'e2',
        status: 'failed',
        notified: true,
      })],
    });
    const { result } = renderHook(() => useExportsCenter());

    await waitFor(() => expect(result.current.unseenCount).toBe(1));
  });

  it('lists a started export first and toasts that it started', async () => {
    mockListExports.mockResolvedValue({ exports: [READY] });
    const { result } = renderHook(() => useExportsCenter());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(() => result.current.start({
      view: 'alerts',
      params: { status: 'open' },
      format: 'csv',
    }));

    expect([result.current.exports[0].view, result.current.toasts[0].message]).toStrictEqual(['alerts', 'Export started — you\'ll be notified when it is ready.']);
  });

  it('rejects start with the API error and adds no export', async () => {
    mockListExports.mockResolvedValue({ exports: [] });
    mockStartExport.mockRejectedValueOnce(new RangeError('Unknown view'));
    const { result } = renderHook(() => useExportsCenter());

    await expect(act(() => result.current.start({
      view: 'alerts',
      params: {},
      format: 'csv',
    }))).rejects.toThrow('Unknown view');
    expect(result.current.exports).toStrictEqual([]);
  });

  it('marks every unseen finished export seen on the server and clears the badge', async () => {
    mockListExports.mockResolvedValue({ exports: [READY, RUNNING] });
    const { result } = renderHook(() => useExportsCenter());
    await waitFor(() => expect(result.current.unseenCount).toBe(1));

    act(() => result.current.markAllSeen());

    expect([mockMarkExportSeen.mock.calls, result.current.unseenCount]).toStrictEqual([[['exp-coruna']], 0]);
  });

  it('removes a deleted export from the list', async () => {
    mockListExports.mockResolvedValue({ exports: [READY] });
    const { result } = renderHook(() => useExportsCenter());
    await waitFor(() => expect(result.current.exports).toHaveLength(1));

    await act(() => result.current.remove('exp-coruna'));

    expect([mockDeleteExport.mock.calls, result.current.exports]).toStrictEqual([[['exp-coruna']], []]);
  });

  it('follows a fresh download URL', async () => {
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { assign },
    });
    mockFetchDownloadUrl.mockResolvedValueOnce('https://bucket.s3.amazonaws.com/f.xlsx?sig=1');
    const { result } = renderHook(() => useExportsCenter());

    await act(() => result.current.download('exp-coruna'));

    expect(assign).toHaveBeenCalledWith('https://bucket.s3.amazonaws.com/f.xlsx?sig=1');
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: original,
    });
  });

  it('loads the next page after the first', async () => {
    mockListExports
      .mockResolvedValueOnce({
        exports: [READY],
        next_token: 'p2',
      })
      .mockResolvedValueOnce({ exports: [buildExportSummary({ export_id: 'older' })] });
    const { result } = renderHook(() => useExportsCenter());
    await waitFor(() => expect(result.current.nextToken).toBe('p2'));

    await act(() => result.current.loadMore());

    expect(result.current.exports.map((item) => item.export_id)).toStrictEqual(['exp-coruna', 'older']);
  });
});

describe('useExports', () => {
  it('is null outside the Exports provider', () => {
    const { result } = renderHook(() => useExports());

    expect(result.current).toBeNull();
  });
});
