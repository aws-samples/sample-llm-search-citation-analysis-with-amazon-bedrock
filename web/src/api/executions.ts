/**
 * Scheduling API client functions.
 */
import { apiGet } from './client';
import type { Schedule } from '../types';

// Re-exported for existing consumers of this module's schedule API.
export type { Schedule };

interface SchedulesResponse {schedules: Schedule[];}

/**
 * Fetches all schedules.
 */
export async function fetchSchedules(signal?: AbortSignal): Promise<Schedule[]> {
  const response = await apiGet<SchedulesResponse>('/schedules', { signal });
  return response.schedules ?? [];
}
