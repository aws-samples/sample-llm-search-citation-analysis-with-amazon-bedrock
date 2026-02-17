import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import {
  fetchExecution, triggerAnalysis, fetchSchedules, createSchedule 
} from './executions';

vi.mock('../infrastructure', () => ({
  API_BASE_URL: 'https://api.test.com',
  authenticatedFetch: vi.fn(),
}));

vi.mock('./client', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  ApiRequestError: class extends Error {
    status: number;
    constructor(msg: string, status: number) {
      super(msg);
      this.status = status;
    }
  },
}));

import { authenticatedFetch } from '../infrastructure';
import {
  apiGet, apiPost 
} from './client';

const mockAuthFetch = authenticatedFetch as ReturnType<typeof vi.fn>;
const mockApiGet = apiGet as ReturnType<typeof vi.fn>;
const mockApiPost = apiPost as ReturnType<typeof vi.fn>;

describe('executions API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('fetchExecution', () => {
    it('fetches execution by encoded ARN', async () => {
      const mockExecution = {
        status: 'RUNNING',
        events: [] 
      };
      mockApiGet.mockResolvedValue(mockExecution);

      const result = await fetchExecution('arn:aws:states:us-east-1:123:execution:test');

      expect(result).toStrictEqual(mockExecution);
      expect(mockApiGet).toHaveBeenCalledWith(
        '/executions/arn%3Aaws%3Astates%3Aus-east-1%3A123%3Aexecution%3Atest',
        { signal: undefined }
      );
    });
  });

  describe('triggerAnalysis', () => {
    it('triggers analysis without keywords', async () => {
      mockAuthFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          execution_arn: 'arn:test',
          status: 'RUNNING' 
        }),
      });

      const result = await triggerAnalysis();

      expect(result.execution_arn).toBe('arn:test');
      expect(mockAuthFetch).toHaveBeenCalledWith(
        'https://api.test.com/trigger-analysis',
        {
          method: 'POST',
          signal: undefined 
        }
      );
    });

    it('triggers keyword analysis with keywords', async () => {
      mockAuthFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          execution_arn: 'arn:test',
          status: 'RUNNING' 
        }),
      });

      await triggerAnalysis({ keywords: ['hotel', 'resort'] });

      expect(mockAuthFetch).toHaveBeenCalledWith(
        'https://api.test.com/trigger-keyword-analysis',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keywords: ['hotel', 'resort'] }),
          signal: undefined,
        }
      );
    });

    it('throws ApiRequestError when response not ok', async () => {
      mockAuthFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(triggerAnalysis()).rejects.toThrow('HTTP 500');
    });
  });

  describe('fetchSchedules', () => {
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

  describe('createSchedule', () => {
    it('creates schedule with options', async () => {
      const mockSchedule = {
        name: 'daily',
        state: 'ENABLED' 
      };
      mockApiPost.mockResolvedValue(mockSchedule);

      const result = await createSchedule({
        name: 'daily',
        schedule: 'rate(1 day)',
        timezone: 'UTC',
        enabled: true,
      });

      expect(result).toStrictEqual(mockSchedule);
      expect(mockApiPost).toHaveBeenCalledWith('/schedules', {
        name: 'daily',
        schedule: 'rate(1 day)',
        timezone: 'UTC',
        enabled: true,
      });
    });
  });
});
