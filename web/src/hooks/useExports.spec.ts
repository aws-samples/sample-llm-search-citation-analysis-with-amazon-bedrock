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
import type { ExportSummary } from '../types/domain/exports';
import {
  emitLive, liveSubscriberCount
} from '../test/liveEventsMock';
import {
  useExports, useExportsCenter
} from './useExports';

vi.mock('../api/exports', () => import('../test/exportsApiMock'));

const RUNNING = buildExportSummary({ status: 'running' });
const READY = buildExportSummary({ status: 'ready' });

beforeEach(() => {
  mockListExports.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Renders the exports center over list reads that answer `lists` in order, the last one for every later read. */
function renderCenterOver(...lists: ExportSummary[][]) {
  for (const list of lists.slice(0, -1)) mockListExports.mockResolvedValueOnce({ exports: list });
  mockListExports.mockResolvedValue({ exports: lists[lists.length - 1] ?? [] });
  return renderHook(() => useExportsCenter());
}

async function waitForListReads(count: number): Promise<void> {
  await waitFor(() => expect(mockListExports).toHaveBeenCalledTimes(count));
}

describe('useExportsCenter live list', () => {
  it('listens to the user’s own exports channel while an export runs, reading once to catch up', async () => {
    renderCenterOver([RUNNING]);

    await waitForListReads(2);
    expect(liveSubscriberCount('exports')).toBe(1);
  });

  it('re-reads the list when one of the user’s exports changes', async () => {
    renderCenterOver([RUNNING]);
    await waitForListReads(2);

    await emitLive('exports', {
      type: 'export.changed',
      export_id: RUNNING.export_id,
      status: 'ready' 
    });

    await waitForListReads(3);
  });

  it('stops listening once no export is queued or running', async () => {
    renderCenterOver([RUNNING], [READY]);

    await waitForListReads(2);
    expect(liveSubscriberCount('exports')).toBe(0);
  });

  it('does not listen when every export is finished', async () => {
    renderCenterOver([READY]);
    await waitForListReads(1);

    expect(liveSubscriberCount('exports')).toBe(0);
  });

  it('toasts that a running export is ready when the read after its event sees it finished', async () => {
    const { result } = renderCenterOver([RUNNING], [READY]);

    await waitFor(() => expect(result.current.toasts.map((toast) => [toast.tone, toast.message])).toStrictEqual([['success', 'Citations export is ready']]));
  });

  it('shows a browser notification when the user allowed them', async () => {
    const notification = vi.fn();
    vi.stubGlobal('Notification', Object.assign(notification, { permission: 'granted' }));
    renderCenterOver([RUNNING], [READY]);

    await waitFor(() => expect(notification).toHaveBeenCalledWith('Citations export is ready', {
      body: 'citations-group-coruna.xlsx',
      tag: 'exp-coruna',
    }));
  });
});

describe('useExportsCenter actions', () => {
  it('counts the finished exports the user has not seen', async () => {
    const { result } = renderCenterOver([READY, buildExportSummary({
      export_id: 'e2',
      status: 'failed',
      notified: true,
    })]);

    await waitFor(() => expect(result.current.unseenCount).toBe(1));
  });

  it('lists a started export first and toasts that it started', async () => {
    const started = buildExportSummary({
      export_id: 'exp-alerts',
      view: 'alerts',
      status: 'queued' 
    });
    mockStartExport.mockResolvedValueOnce(started);
    const { result } = renderCenterOver([READY], [started, READY]);
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(() => result.current.start({
      view: 'alerts',
      params: { status: 'open' },
      format: 'csv',
    }));

    expect([result.current.exports[0].view, result.current.toasts[0].message]).toStrictEqual(['alerts', 'Export started — you\'ll be notified when it is ready.']);
  });

  it('rejects start with the API error and adds no export', async () => {
    mockStartExport.mockRejectedValueOnce(new RangeError('Unknown view'));
    const { result } = renderCenterOver([]);

    await expect(act(() => result.current.start({
      view: 'alerts',
      params: {},
      format: 'csv',
    }))).rejects.toThrow('Unknown view');
    expect(result.current.exports).toStrictEqual([]);
  });

  it('marks every unseen finished export seen on the server and clears the badge', async () => {
    const { result } = renderCenterOver([READY, RUNNING]);
    await waitFor(() => expect(result.current.unseenCount).toBe(1));

    act(() => result.current.markAllSeen());

    expect([mockMarkExportSeen.mock.calls, result.current.unseenCount]).toStrictEqual([[['exp-coruna']], 0]);
  });

  it('removes a deleted export from the list', async () => {
    const { result } = renderCenterOver([READY]);
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
      .mockResolvedValueOnce({
        exports: [buildExportSummary({
          export_id: 'older',
          status: 'ready' 
        })] 
      });
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
