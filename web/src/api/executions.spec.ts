import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import {
  createSchedule, deleteSchedule, fetchSchedules, runSchedule, updateSchedule 
} from './executions';
import type { SchedulePayload } from './executions';

vi.mock('./client', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
}));

import {
  apiDelete, apiGet, apiPost, apiPut 
} from './client';

const mockApiGet = vi.mocked(apiGet);
const mockApiPost = vi.mocked(apiPost);
const mockApiPut = vi.mocked(apiPut);
const mockApiDelete = vi.mocked(apiDelete);

const payload: SchedulePayload = {
  display_name: 'Hotel Coruña — weekly',
  frequency: 'weekly',
  time: '09:00',
  timezone: 'Europe/Madrid',
  day_of_week: 'MON',
  day_of_month: 1,
  enabled: true,
  scope: {
    mode: 'groups',
    group_ids: ['group-coruna'] 
  },
};

describe('executions API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('fetchSchedules', () => {
    it('requests /schedules with the abort signal', async () => {
      const controller = new AbortController();
      mockApiGet.mockResolvedValue({ schedules: [] });

      await fetchSchedules(controller.signal);

      expect(mockApiGet).toHaveBeenCalledWith('/schedules', { signal: controller.signal });
    });

    it('returns schedules array from response', async () => {
      const mockSchedules = [{
        id: 'sch-1',
        display_name: 'daily',
        state: 'ENABLED' 
      }];
      mockApiGet.mockResolvedValue({ schedules: mockSchedules });

      const result = await fetchSchedules();

      expect(result).toStrictEqual(mockSchedules);
    });

    it('returns empty array when schedules is undefined', async () => {
      mockApiGet.mockResolvedValue({});

      const result = await fetchSchedules();

      expect(result).toStrictEqual([]);
    });
  });

  describe('mutations', () => {
    it('creates through POST /schedules surfacing structured 4xx errors', async () => {
      mockApiPost.mockResolvedValue({ id: 'sch-1' });

      await createSchedule(payload);

      expect(mockApiPost).toHaveBeenCalledWith('/schedules', payload, { allowStructured4xx: true });
    });

    it('updates through PUT /schedules/{id} with the id encoded', async () => {
      mockApiPut.mockResolvedValue({ id: 'sch 1' });

      await updateSchedule('sch 1', payload);

      expect(mockApiPut).toHaveBeenCalledWith('/schedules/sch%201', payload, { allowStructured4xx: true });
    });

    it('deletes through DELETE /schedules/{id}', async () => {
      mockApiDelete.mockResolvedValue({});

      await deleteSchedule('sch-1');

      expect(mockApiDelete).toHaveBeenCalledWith('/schedules/sch-1', { allowStructured4xx: true });
    });

    it('runs now through POST /schedules/{id}/run and returns the execution', async () => {
      mockApiPost.mockResolvedValue({
        execution_arn: 'arn',
        execution_name: 'schedule-run-1',
        schedule_id: 'sch-1',
        scope_summary: '1 group(s)',
        message: 'started',
      });

      const result = await runSchedule('sch-1');

      expect(mockApiPost).toHaveBeenCalledWith('/schedules/sch-1/run', {}, { allowStructured4xx: true });
      expect(result.execution_name).toBe('schedule-run-1');
    });
  });
});
