import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import { ScheduleManager } from './ScheduleManager';

import type { Schedule } from '../../types';

vi.mock('../../infrastructure', () => ({
  API_BASE_URL: 'https://api.test.com',
  authenticatedFetch: vi.fn(),
}));

const mockSchedules: Schedule[] = [
  {
    name: 'daily-analysis',
    state: 'ENABLED',
    schedule: 'rate(1 day)',
    timezone: 'UTC',
  },
];

describe('ScheduleManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    render(<ScheduleManager schedules={[]} setSchedules={vi.fn()} />);
    expect(document.body).toBeTruthy();
  });

  it('renders schedule name when schedules exist', () => {
    render(<ScheduleManager schedules={mockSchedules} setSchedules={vi.fn()} />);
    expect(screen.getByText('daily-analysis')).toBeInTheDocument();
  });

  it('shows empty state when no schedules', () => {
    render(<ScheduleManager schedules={[]} setSchedules={vi.fn()} />);
    expect(screen.getByText(/No schedules/i)).toBeInTheDocument();
  });
});
