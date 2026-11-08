import {
  useEffect, useState
} from 'react';
import {
  CursorExpiredError, fetchListPage, type ListPage, type ListPaging, type ListRequest, type ListSource
} from '../api/scopedListPages';
import {
  getErrorMessage, isAbortError
} from '../infrastructure';
import {
  isGroupRun, type GroupKpiHistoryResponse, type GroupRun
} from '../types/domain/groupKpiHistory';

/** A `view=runs` page: the page is the list, `next_token` its cursor (2.45.0 wave 5). */
const GROUP_RUNS_PAGING: ListPaging = {
  list: 'runs',
  token: 'next_token',
  total: 'runs_total',
  view: null,
};

/** Every run of the window, or why it could not be read; `runs` is `null` while the summary's own runs are whole or loading. */
export interface EveryGroupRun {
  readonly runs: readonly GroupRun[] | null;
  readonly loading: boolean;
  readonly error: string | null;
}

const IDLE: EveryGroupRun = {
  runs: null,
  loading: false,
  error: null,
};

/** The summary GET as a `view=runs` read from the first run. */
function runsRequest(request: ListRequest): ListRequest {
  const params = new URLSearchParams(request.params ?? '');
  params.delete('next_token');
  params.delete('limit');
  params.set('view', 'runs');
  return {
    path: request.path,
    params,
  };
}

/** The runs of the page after `token` (the first page for `null`) and of every page after it, after `read`. */
async function readRunsFrom(source: ListSource<GroupRun>, token: string | null, signal: AbortSignal, read: readonly GroupRun[]): Promise<GroupRun[]> {
  const page: ListPage<GroupRun> = await fetchListPage(source, token, signal);
  const runs = [...read, ...page.items];
  return page.nextToken === null ? runs : readRunsFrom(source, page.nextToken, signal, runs);
}

/** Every run from the first; a cursor that expired mid-read (a new snapshot build) reads them again once. */
async function readEveryRun(request: ListRequest, signal: AbortSignal): Promise<GroupRun[]> {
  const source: ListSource<GroupRun> = {
    request: runsRequest(request),
    paging: GROUP_RUNS_PAGING,
    isItem: isGroupRun,
  };
  try {
    return await readRunsFrom(source, null, signal, []);
  } catch (error) {
    if (!(error instanceof CursorExpiredError)) throw error;
    return readRunsFrom(source, null, signal, []);
  }
}

/**
 * Every run of a group KPI summary that kept only its newest runs (`runs_truncated`): reads
 * `view=runs` page by page, oldest first, so the headline and the trend cover the whole period.
 * Nothing is read for a summary that holds every run.
 */
export function useEveryGroupRun(history: GroupKpiHistoryResponse | null, request: ListRequest | null): EveryGroupRun {
  const [state, setState] = useState<EveryGroupRun>(IDLE);
  const cut = history?.runs_truncated === true;

  useEffect(() => {
    if (!cut || request === null) {
      setState(IDLE);
      return undefined;
    }
    const controller = new AbortController();
    setState({
      runs: null,
      loading: true,
      error: null,
    });
    readEveryRun(request, controller.signal).then((runs) => {
      if (!controller.signal.aborted) {
        setState({
          runs,
          loading: false,
          error: null,
        });
      }
    }, (error: unknown) => {
      if (!controller.signal.aborted && !isAbortError(error)) {
        setState({
          runs: null,
          loading: false,
          error: getErrorMessage(error),
        });
      }
    });
    return () => controller.abort();
  }, [cut, history, request]);

  return state;
}
