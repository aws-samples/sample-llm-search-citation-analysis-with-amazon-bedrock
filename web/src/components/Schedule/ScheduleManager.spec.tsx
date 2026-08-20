import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import {
  render, screen, waitFor 
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScheduleManager } from './ScheduleManager';

import type {
  Keyword, Schedule 
} from '../../types';

vi.mock('../../infrastructure', () => ({
  API_BASE_URL: 'https://api.test.com',
  authenticatedFetch: vi.fn(),
  isAbortError: vi.fn(() => false),
}));

vi.mock('../../api/executions', () => ({fetchSchedules: vi.fn(),}));

vi.mock('../../hooks/useIsAdmin', () => ({useIsAdmin: vi.fn(),}));

import { authenticatedFetch } from '../../infrastructure';
import { fetchSchedules } from '../../api/executions';
import { useIsAdmin } from '../../hooks/useIsAdmin';

const mockAuthFetch = authenticatedFetch as ReturnType<typeof vi.fn>;
const mockFetchSchedules = fetchSchedules as ReturnType<typeof vi.fn>;
const mockUseIsAdmin = useIsAdmin as ReturnType<typeof vi.fn>;

const mockSchedules: Schedule[] = [
  {
    name: 'daily-analysis',
    state: 'ENABLED',
    schedule: 'rate(1 day)',
    timezone: 'UTC',
  },
];

const mockKeywords: Keyword[] = [
  {
    id: 'kw-1',
    keyword: 'best hotels malaga',
    created_at: '2024-01-01T00:00:00Z',
  },
  {
    id: 'kw-2',
    keyword: 'boutique hotels madrid',
    created_at: '2024-01-02T00:00:00Z',
  },
];

function buildProps(overrides = {}) {
  return {
    schedules: [] satisfies Schedule[],
    setSchedules: vi.fn(),
    keywords: mockKeywords,
    ...overrides,
  };
}

async function openScheduleForm() {
  await userEvent.click(screen.getByRole('button', { name: /New Schedule/i }));
}

function firstCreateRequestBody(): unknown {
  const [, requestInit] = mockAuthFetch.mock.calls[0] as [string, RequestInit];
  return JSON.parse(String(requestInit.body)) as unknown;
}

describe('ScheduleManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Create and delete are Admin-only; the existing suite exercises them, so
    // an admin caller is the default. The non-admin cases are asserted in the
    // 'admin-only controls' block below.
    mockUseIsAdmin.mockReturnValue({
      isAdmin: true,
      loading: false,
    });
    mockFetchSchedules.mockResolvedValue([]);
  });

  describe('schedule list', () => {
    it('renders schedule name when schedules exist', () => {
      render(<ScheduleManager {...buildProps({ schedules: mockSchedules })} />);
      expect(screen.getByText('daily-analysis')).toBeInTheDocument();
    });

    it('shows empty state when no schedules', () => {
      render(<ScheduleManager {...buildProps()} />);
      expect(screen.getByText(/No schedules/i)).toBeInTheDocument();
    });

    it('shows all-keywords scope for schedules without linked keywords', () => {
      render(<ScheduleManager {...buildProps({ schedules: mockSchedules })} />);
      expect(screen.getByText('Runs all active keywords')).toBeInTheDocument();
    });

    it('shows linked keywords for keyword-scoped schedules', () => {
      const keywordSchedule: Schedule[] = [
        {
          name: 'priority-daily',
          state: 'ENABLED',
          schedule: 'cron(0 7 * * ? *)',
          timezone: 'UTC',
          keywords: ['best hotels malaga', 'boutique hotels madrid'],
        },
      ];
      render(<ScheduleManager {...buildProps({ schedules: keywordSchedule })} />);
      expect(
        screen.getByText('Runs 2 keyword(s): best hotels malaga, boutique hotels madrid')
      ).toBeInTheDocument();
    });
  });

  describe('initial load', () => {
    it('loads schedules from the API on mount', async () => {
      const props = buildProps();
      mockFetchSchedules.mockResolvedValue(mockSchedules);

      render(<ScheduleManager {...props} />);

      await waitFor(() => expect(props.setSchedules).toHaveBeenCalledWith(mockSchedules));
    });
  });

  describe('keyword scope selection', () => {
    it('defaults to running all keywords', async () => {
      render(<ScheduleManager {...buildProps()} />);
      await openScheduleForm();

      expect(screen.getByRole('radio', { name: /All keywords/i })).toBeChecked();
    });

    it('lists available keywords when specific scope is selected', async () => {
      render(<ScheduleManager {...buildProps()} />);
      await openScheduleForm();

      await userEvent.click(screen.getByRole('radio', { name: /Specific keywords/i }));

      expect(screen.getByRole('checkbox', { name: 'best hotels malaga' })).toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: 'boutique hotels madrid' })).toBeInTheDocument();
    });

    it('prompts to add keywords when none exist for specific scope', async () => {
      render(<ScheduleManager {...buildProps({ keywords: [] })} />);
      await openScheduleForm();

      await userEvent.click(screen.getByRole('radio', { name: /Specific keywords/i }));

      expect(screen.getByText(/No keywords available yet/i)).toBeInTheDocument();
    });
  });

  describe('schedule creation', () => {
    it('submits an empty keyword subset when all keywords is selected', async () => {
      mockAuthFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ message: 'created' }),
      });
      render(<ScheduleManager {...buildProps()} />);
      await openScheduleForm();

      await userEvent.click(screen.getByRole('button', { name: 'Create Schedule' }));

      expect(firstCreateRequestBody()).toMatchObject({ keywords: [] });
    });

    it('submits the selected keywords when specific scope is chosen', async () => {
      mockAuthFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ message: 'created' }),
      });
      render(<ScheduleManager {...buildProps()} />);
      await openScheduleForm();
      await userEvent.click(screen.getByRole('radio', { name: /Specific keywords/i }));
      await userEvent.click(screen.getByRole('checkbox', { name: 'best hotels malaga' }));

      await userEvent.click(screen.getByRole('button', { name: 'Create Schedule' }));

      expect(firstCreateRequestBody()).toMatchObject({ keywords: ['best hotels malaga'] });
    });

    it('blocks submission when specific scope has no keywords selected', async () => {
      render(<ScheduleManager {...buildProps()} />);
      await openScheduleForm();
      await userEvent.click(screen.getByRole('radio', { name: /Specific keywords/i }));

      await userEvent.click(screen.getByRole('button', { name: 'Create Schedule' }));

      expect(screen.getByText('Select at least one keyword for this schedule')).toBeInTheDocument();
      expect(mockAuthFetch).not.toHaveBeenCalled();
    });

    it('refreshes the schedule list after a successful creation', async () => {
      const props = buildProps();
      mockAuthFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ message: 'created' }),
      });
      mockFetchSchedules.mockResolvedValue(mockSchedules);
      render(<ScheduleManager {...props} />);
      await openScheduleForm();

      await userEvent.click(screen.getByRole('button', { name: 'Create Schedule' }));

      await waitFor(() => expect(props.setSchedules).toHaveBeenCalledWith(mockSchedules));
      expect(mockFetchSchedules).toHaveBeenCalledTimes(2);
    });
  });
});


describe('ScheduleManager admin-only controls', () => {
  /**
   * POST /api/schedules and DELETE /api/schedules/{name} are Admin-only
   * server-side. Reads stay open, so a non-admin keeps visibility of what is
   * scheduled without any control that would return 403.
   */

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseIsAdmin.mockReturnValue({
      isAdmin: false,
      loading: false,
    });
    mockFetchSchedules.mockResolvedValue([]);
  });

  it('hides the new schedule button from non-admin users', () => {
    render(<ScheduleManager {...buildProps()} />);

    expect(screen.queryByRole('button', { name: /New Schedule/i })).not.toBeInTheDocument();
  });

  it('hides the per-row delete button from non-admin users', () => {
    render(<ScheduleManager {...buildProps({ schedules: mockSchedules })} />);

    expect(
      screen.queryByRole('button', { name: /Delete schedule daily-analysis/i })
    ).not.toBeInTheDocument();
  });

  it('still lists existing schedules for non-admin users', () => {
    render(<ScheduleManager {...buildProps({ schedules: mockSchedules })} />);

    expect(screen.getByText('daily-analysis')).toBeInTheDocument();
  });

  it('tells non-admin users an administrator adds schedules', () => {
    /** The admin copy says "Create a schedule", which they cannot do. */
    render(<ScheduleManager {...buildProps()} />);

    expect(screen.getByText(/An administrator can add a schedule/i)).toBeInTheDocument();
  });

  it('shows the delete button to admin users', () => {
    /** Guards the assertions above from passing because of a renamed label. */
    mockUseIsAdmin.mockReturnValue({
      isAdmin: true,
      loading: false,
    });

    render(<ScheduleManager {...buildProps({ schedules: mockSchedules })} />);

    expect(
      screen.getByRole('button', { name: /Delete schedule daily-analysis/i })
    ).toBeInTheDocument();
  });
});
