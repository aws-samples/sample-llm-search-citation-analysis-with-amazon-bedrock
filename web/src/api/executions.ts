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
import type {
  AnalysisScope, Schedule, ScheduleFrequency
} from '../types';

// Re-exported for existing consumers of this module's schedule API.
export type { Schedule };

interface SchedulesResponse {schedules: Schedule[];}

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

export interface ScheduleRunResponse {
  execution_arn: string;
  execution_name: string;
  schedule_id: string;
  scope_summary: string;
  message: string;
}

/**
 * Fetches all schedules.
 */
export async function fetchSchedules(signal?: AbortSignal): Promise<Schedule[]> {
  const response = await apiGet<SchedulesResponse>('/schedules', { signal });
  return response.schedules ?? [];
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
