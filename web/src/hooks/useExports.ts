/**
 * The Exports center (2.45.0): the caller's exports, read on mount and, while any is queued or
 * running, again whenever one of them changes status (the user's own `exports` channel, TENETS.md
 * tenet 8) and once on every (re)connect; a toast when one is started or finishes, a browser
 * notification when the user allowed it, and the header badge count of finished exports the
 * user has not seen. One instance lives in `ExportsProvider`; views read it with `useExports`.
 */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState
} from 'react';
import {
  deleteExport, fetchDownloadUrl, isExportActive, listExports, markExportSeen, startExport, type ExportRequest
} from '../api/exports';
import { getErrorMessage } from '../infrastructure';
import { userChannel } from '../infrastructure/liveEvents';
import type { ExportSummary } from '../types/domain/exports';
import {
  appendPage, countUnseen, finishedBetween, markedSeen, mergeFirstPage
} from './exportsState';
import {
  finishedExportTitle, notifyExportFinished
} from './exportNotifications';
import { useLiveRefresh } from './useLiveRefresh';

/** The signed-in user's own exports channel: nobody else hears their exports change. */
const EXPORTS_CHANNEL = userChannel('exports');

/** A short message in the corner; `started` and `ready` link to the Exports page. */
export interface ExportToast {
  readonly id: string;
  readonly tone: 'info' | 'success' | 'error';
  readonly message: string;
}

export interface ExportsCenter {
  readonly exports: readonly ExportSummary[];
  /** More (older) exports to load; `null` on the last page. */
  readonly nextToken: string | null;
  readonly loading: boolean;
  readonly loadingMore: boolean;
  readonly error: string | null;
  readonly unseenCount: number;
  readonly toasts: readonly ExportToast[];
  /** Starts an export; rejects with the API's message (e.g. too many running). */
  readonly start: (request: ExportRequest) => Promise<ExportSummary>;
  readonly loadMore: () => Promise<void>;
  readonly remove: (exportId: string) => Promise<void>;
  /** Reads a fresh presigned URL and follows it (the file downloads as an attachment). */
  readonly download: (exportId: string) => Promise<void>;
  /** Marks every finished export the user has not seen as seen (the Exports page is open). */
  readonly markAllSeen: () => void;
  readonly dismissToast: (toastId: string) => void;
}

interface ListState {
  readonly exports: readonly ExportSummary[];
  readonly nextToken: string | null;
}

const EMPTY_LIST: ListState = {
  exports: [],
  nextToken: null,
};

function useToasts() {
  const [toasts, setToasts] = useState<readonly ExportToast[]>([]);
  const counter = useRef(0);
  const push = useCallback((tone: ExportToast['tone'], message: string) => {
    counter.current += 1;
    const id = `toast-${counter.current}`;
    setToasts((current) => [...current, {
      id,
      tone,
      message,
    }]);
  }, []);
  const dismiss = useCallback((toastId: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== toastId));
  }, []);
  return {
    toasts,
    push,
    dismiss,
  };
}

function announceFinished(finished: readonly ExportSummary[], push: (tone: ExportToast['tone'], message: string) => void): void {
  finished.forEach((summary) => {
    push(summary.status === 'ready' ? 'success' : 'error', finishedExportTitle(summary));
    notifyExportFinished(summary);
  });
}

/** The list state, its first-page refresh (which announces finished exports) and "Load more". */
function useExportList(push: (tone: ExportToast['tone'], message: string) => void) {
  const [list, setList] = useState<ListState>(EMPTY_LIST);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef(list);

  const apply = useCallback((next: ListState) => {
    announceFinished(finishedBetween(listRef.current.exports, next.exports), push);
    listRef.current = next;
    setList(next);
  }, [push]);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const page = await listExports(null, signal);
      if (signal?.aborted === true) return;
      const current = listRef.current;
      const pageToken = page.next_token ?? null;
      const merged = mergeFirstPage(current.exports, page.exports, pageToken !== null);
      apply({
        exports: merged,
        nextToken: merged.length > page.exports.length ? current.nextToken : pageToken,
      });
      setError(null);
    } catch (refreshError) {
      if (signal?.aborted !== true) setError(getErrorMessage(refreshError));
    } finally {
      if (signal?.aborted !== true) setLoading(false);
    }
  }, [apply]);

  const loadMore = useCallback(async () => {
    const token = listRef.current.nextToken;
    if (token === null) return;
    setLoadingMore(true);
    try {
      const page = await listExports(token);
      apply({
        exports: appendPage(listRef.current.exports, page.exports),
        nextToken: page.next_token ?? null,
      });
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setLoadingMore(false);
    }
  }, [apply]);

  return {
    list,
    listRef,
    apply,
    loading,
    loadingMore,
    error,
    refresh,
    loadMore,
  };
}

function useLiveList(exports: readonly ExportSummary[], refresh: (signal?: AbortSignal) => Promise<void>): void {
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  const active = exports.some(isExportActive);
  useLiveRefresh(active ? EXPORTS_CHANNEL : null, () => refresh());
}

/** The single Exports center state (mounted once, in `ExportsProvider`). */
export function useExportsCenter(): ExportsCenter {
  const {
    toasts, push, dismiss
  } = useToasts();
  const {
    list, listRef, apply, loading, loadingMore, error, refresh, loadMore
  } = useExportList(push);
  useLiveList(list.exports, refresh);

  const start = useCallback(async (request: ExportRequest) => {
    const summary = await startExport(request);
    apply({
      ...listRef.current,
      exports: [summary, ...listRef.current.exports.filter((item) => item.export_id !== summary.export_id)],
    });
    push('info', 'Export started — you\'ll be notified when it is ready.');
    return summary;
  }, [apply, listRef, push]);

  const remove = useCallback(async (exportId: string) => {
    await deleteExport(exportId);
    apply({
      ...listRef.current,
      exports: listRef.current.exports.filter((item) => item.export_id !== exportId),
    });
  }, [apply, listRef]);

  const download = useCallback(async (exportId: string) => {
    const url = await fetchDownloadUrl(exportId);
    window.location.assign(url);
  }, []);

  const markAllSeen = useCallback(() => {
    const unseen = listRef.current.exports
      .filter((item) => (item.status === 'ready' || item.status === 'failed') && !item.notified)
      .map((item) => item.export_id);
    if (unseen.length === 0) return;
    apply({
      ...listRef.current,
      exports: markedSeen(listRef.current.exports, new Set(unseen)),
    });
    unseen.forEach((exportId) => {
      markExportSeen(exportId).catch((seenError: unknown) => console.error('[exports] Marking an export seen failed:', seenError));
    });
  }, [apply, listRef]);

  return useMemo(() => ({
    exports: list.exports,
    nextToken: list.nextToken,
    loading,
    loadingMore,
    error,
    unseenCount: countUnseen(list.exports),
    toasts,
    start,
    loadMore,
    remove,
    download,
    markAllSeen,
    dismissToast: dismiss,
  }), [list, loading, loadingMore, error, toasts, start, loadMore, remove, download, markAllSeen, dismiss]);
}

export const EXPORTS_CONTEXT = createContext<ExportsCenter | null>(null);

/** The Exports center of `ExportsProvider`; `null` outside it (a view rendered on its own in a spec). */
export function useExports(): ExportsCenter | null {
  return useContext(EXPORTS_CONTEXT);
}
