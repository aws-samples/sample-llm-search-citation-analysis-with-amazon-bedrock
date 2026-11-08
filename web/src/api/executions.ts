/**
 * Scheduling API client functions.
 *
 * Schedules are EventBridge Scheduler schedules addressed by their generated
 * id. Mutations are Admin-only server-side; 4xx bodies carry the field that
 * was rejected, so they are surfaced structurally.
 */
import {
  apiDelete, apiGet, apiPost, apiPut
} from './client';
import {
  collectCursorPages, withNextToken, type CursorPage
} from './cursorPages';
import type {
  AnalysisScope, RankTrackerSchedule, Schedule, ScheduleFormData
} from '../types';

// Re-exported for existing consumers of this module's schedule API.
export type { Schedule };

interface SchedulesResponse {
  schedules?: Schedule[];
  next_token?: string | null;
}

/**
 * What the API accepts on create and update: the form with the day of month
 * as a number. `kind` is read on create only (a schedule keeps its kind);
 * `scope` is sent for analysis schedules only, as snapshot kinds cover every
 * owned and competitor domain.
 */
export type SchedulePayload = Omit<ScheduleFormData, 'day_of_month' | 'scope'> & {
  day_of_month: number;
  scope?: AnalysisScope;
  /** Required by the API to save an enabled paid (snapshot) schedule: sent after the dashboard's confirmation. */
  confirm_paid?: true;
};

export interface ScheduleRunResponse {message: string;}

/** Schedules per page; pages are also cut by the API's response budget. */
const SCHEDULES_PAGE_LIMIT = '100';

async function fetchSchedulePage(nextToken: string | null, signal?: AbortSignal): Promise<CursorPage<Schedule>> {
  const response = await apiGet<SchedulesResponse>('/schedules', {
    signal,
    params: withNextToken({ limit: SCHEDULES_PAGE_LIMIT }, nextToken),
  });
  return {
    items: response.schedules ?? [],
    nextToken: typeof response.next_token === 'string' ? response.next_token : null,
  };
}

/**
 * Fetches all schedules, newest first, following the list's `next_token`.
 */
export async function fetchSchedules(signal?: AbortSignal): Promise<Schedule[]> {
  return collectCursorPages((nextToken) => fetchSchedulePage(nextToken, signal));
}

export async function createSchedule(payload: SchedulePayload): Promise<Schedule> {
  return apiPost<Schedule>('/schedules', payload, { allowStructured4xx: true });
}

export async function updateSchedule(id: string, payload: SchedulePayload): Promise<Schedule> {
  return apiPut<Schedule>(`/schedules/${encodeURIComponent(id)}`, payload, { allowStructured4xx: true });
}

export async function deleteSchedule(id: string): Promise<void> {
  await apiDelete<unknown>(`/schedules/${encodeURIComponent(id)}`, { allowStructured4xx: true });
}

/**
 * Start the schedule's run now: an analysis with its scope, or its snapshots. A snapshot run is paid, so the API
 * requires `confirmPaid` (sent after the dashboard's confirmation).
 */
export async function runSchedule(id: string, confirmPaid = false): Promise<ScheduleRunResponse> {
  const body = confirmPaid ? { confirm_paid: true } : {};
  return apiPost<ScheduleRunResponse>(`/schedules/${encodeURIComponent(id)}/run`, body, { allowStructured4xx: true });
}

interface RankTrackerSchedulesResponse {
  schedules?: RankTrackerSchedule[];
  truncated?: boolean;
}

/** The rank trackers' own schedules (next check of each), soonest first; read-only here. */
export interface RankTrackerScheduleList {
  schedules: RankTrackerSchedule[];
  /** More trackers are scheduled than one answer lists (100). */
  truncated: boolean;
}

export async function fetchRankTrackerSchedules(signal?: AbortSignal): Promise<RankTrackerScheduleList> {
  const response = await apiGet<RankTrackerSchedulesResponse>('/schedules', {
    signal,
    params: { source: 'rank-trackers' },
  });
  return {
    schedules: response.schedules ?? [],
    truncated: response.truncated === true,
  };
}
