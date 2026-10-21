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
  AnalysisScope, Schedule, ScheduleFrequency
} from '../types';

// Re-exported for existing consumers of this module's schedule API.
export type { Schedule };

interface SchedulesResponse {
  schedules?: Schedule[];
  next_token?: string | null;
}

/** What the API accepts on create and update (every field optional on update). */
export interface SchedulePayload {
  display_name: string;
  frequency: ScheduleFrequency;
  time: string;
  timezone: string;
  day_of_week: string;
  day_of_month: number;
  enabled: boolean;
  scope: AnalysisScope;
}

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

/** Start an analysis now with the schedule's scope. */
export async function runSchedule(id: string): Promise<ScheduleRunResponse> {
  return apiPost<ScheduleRunResponse>(`/schedules/${encodeURIComponent(id)}/run`, {}, { allowStructured4xx: true });
}
