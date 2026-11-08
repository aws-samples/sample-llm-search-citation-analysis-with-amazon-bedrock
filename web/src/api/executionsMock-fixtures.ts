/**
 * Shared replacement for `api/executions` in the Schedule page specs.
 *
 * ```ts
 * vi.mock('../../api/executions', () => import('../../api/executionsMock-fixtures'));
 * import { createSchedule } from '../../api/executions';
 * ```
 *
 * The factory's dynamic import and a spec's static import resolve to the same
 * module, so `vi.mocked(createSchedule)` drives the function the component
 * calls. The rank tracker list answers no tracker unless a spec says otherwise.
 */
import { vi } from 'vitest';
import type {
  createSchedule as CreateSchedule,
  deleteSchedule as DeleteSchedule,
  fetchRankTrackerSchedules as FetchRankTrackerSchedules,
  fetchSchedules as FetchSchedules,
  runSchedule as RunSchedule,
  updateSchedule as UpdateSchedule,
} from './executions';

export const fetchSchedules = vi.fn<typeof FetchSchedules>();
export const createSchedule = vi.fn<typeof CreateSchedule>();
export const updateSchedule = vi.fn<typeof UpdateSchedule>();
export const deleteSchedule = vi.fn<typeof DeleteSchedule>();
export const runSchedule = vi.fn<typeof RunSchedule>();
export const fetchRankTrackerSchedules = vi.fn<typeof FetchRankTrackerSchedules>(() => Promise.resolve({
  schedules: [],
  truncated: false,
}));
