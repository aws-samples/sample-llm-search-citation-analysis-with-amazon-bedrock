import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import { fetchSchedules } from './executions';

vi.mock('./client', () => ({apiGet: vi.fn(),}));

import { apiGet } from './client';

const mockApiGet = apiGet as ReturnType<typeof vi.fn>;

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
        name: 'daily',
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
});
