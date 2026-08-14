/**
 * Execution and scheduling API client functions.
 */
import {
  API_BASE_URL, authenticatedFetch 
} from '../infrastructure';
import {
  apiGet, apiPost, ApiRequestError 
} from './client';
import type {
  Execution, Schedule, ScheduleFormData 
} from '../types';

// Re-exported for existing consumers of this module's schedule API.
export type { Schedule };

/**
 * Fetches execution status by ARN.
 */
export function fetchExecution(executionArn: string, signal?: AbortSignal): Promise<Execution> {
  const encodedArn = encodeURIComponent(executionArn);
  return apiGet<Execution>(`/executions/${encodedArn}`, { signal });
}

interface TriggerAnalysisOptions {
  keywords?: string[];
  signal?: AbortSignal;
}

interface TriggerResponse {
  execution_arn: string;
  status: string;
}

/**
 * Triggers a new analysis run.
 */
export async function triggerAnalysis(
  options: TriggerAnalysisOptions = {}
): Promise<TriggerResponse> {
  const {
    keywords, signal 
  } = options;
  
  // Use different endpoint based on whether keywords are provided
  const endpoint = keywords?.length
    ? `${API_BASE_URL}/trigger-keyword-analysis`
    : `${API_BASE_URL}/trigger-analysis`;
  
  const requestOptions: RequestInit = keywords?.length
    ? {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keywords }),
      signal,
    }
    : {
      method: 'POST',
      signal 
    };

  const response = await authenticatedFetch(endpoint, requestOptions);
  
  if (!response.ok) {
    throw new ApiRequestError(`HTTP ${response.status}: ${response.statusText}`, response.status);
  }

  const data: unknown = await response.json();
  return data as TriggerResponse;
}

interface SchedulesResponse {schedules: Schedule[];}

/**
 * Fetches all schedules.
 */
export async function fetchSchedules(signal?: AbortSignal): Promise<Schedule[]> {
  const response = await apiGet<SchedulesResponse>('/schedules', { signal });
  return response.schedules ?? [];
}

/**
 * Creates a new schedule. `keywords` links the schedule to a keyword subset;
 * an empty array runs all active keywords at execution time.
 */
export function createSchedule(options: ScheduleFormData): Promise<Schedule> {
  return apiPost<Schedule>('/schedules', options);
}
