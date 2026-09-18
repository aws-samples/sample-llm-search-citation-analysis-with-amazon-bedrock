import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import {
  render, screen, waitFor, within 
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScheduleManager } from './ScheduleManager';
import {
  GROUP_CORUNA, GROUP_MARINO, buildSchedule, legacyKeywordSchedule, mockKeywords 
} from './ScheduleManager-fixtures';
import type { Schedule } from '../../types';

vi.mock('../../infrastructure', async () => {
  const actual: Record<string, unknown> = await vi.importActual('../../infrastructure');
  return {
    ...actual,
    isAbortError: vi.fn(() => false),
  };
});

vi.mock('../../api/executions', () => ({
  fetchSchedules: vi.fn(),
  createSchedule: vi.fn(),
  updateSchedule: vi.fn(),
  deleteSchedule: vi.fn(),
  runSchedule: vi.fn(),
}));

vi.mock('../../hooks/useIsAdmin', () => ({ useIsAdmin: vi.fn() }));
vi.mock('../../hooks/useKeywordGroups', () => ({ useKeywordGroups: vi.fn() }));

import {
  createSchedule, deleteSchedule, fetchSchedules, runSchedule, updateSchedule 
} from '../../api/executions';
import { useIsAdmin } from '../../hooks/useIsAdmin';
import { useKeywordGroups } from '../../hooks/useKeywordGroups';
import { ApiRequestError } from '../../infrastructure';

const mockFetchSchedules = vi.mocked(fetchSchedules);
const mockCreateSchedule = vi.mocked(createSchedule);
const mockUpdateSchedule = vi.mocked(updateSchedule);
const mockDeleteSchedule = vi.mocked(deleteSchedule);
const mockRunSchedule = vi.mocked(runSchedule);
const mockUseIsAdmin = vi.mocked(useIsAdmin);
const mockUseKeywordGroups = vi.mocked(useKeywordGroups);

const weeklySchedule = buildSchedule();

function buildProps(overrides: { schedules?: Schedule[] } = {}) {
  return {
    schedules: overrides.schedules ?? [],
    setSchedules: vi.fn(),
    keywords: mockKeywords,
  };
}

function mockGroups(groups = [GROUP_CORUNA, GROUP_MARINO]) {
  mockUseKeywordGroups.mockReturnValue({
    groups,
    loading: false,
    error: null,
    refresh: vi.fn(),
    createGroup: vi.fn(),
    renameGroup: vi.fn(),
    removeGroup: vi.fn(),
    changeMemberships: vi.fn(),
  });
}

async function openCreateForm() {
  await userEvent.click(screen.getByRole('button', { name: /New Schedule/i }));
}

async function openEditForm(displayName: string) {
  await userEvent.click(screen.getByRole('button', { name: `Edit schedule ${displayName}` }));
}

describe('ScheduleManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseIsAdmin.mockReturnValue({
      isAdmin: true,
      loading: false,
    });
    mockGroups();
    mockFetchSchedules.mockResolvedValue([]);
    mockCreateSchedule.mockResolvedValue(weeklySchedule);
    mockUpdateSchedule.mockResolvedValue(weeklySchedule);
    mockDeleteSchedule.mockResolvedValue();
    mockRunSchedule.mockResolvedValue({
      execution_arn: 'arn',
      execution_name: 'schedule-run-1',
      schedule_id: weeklySchedule.id,
      scope_summary: '1 group(s)',
      message: 'Analysis started for Hotel Coruña — weekly (1 group(s))',
    });
  });

  describe('schedule list', () => {
    it('renders the display name, not the generated id', () => {
      render(<ScheduleManager {...buildProps({ schedules: [weeklySchedule] })} />);

      expect(screen.getByText('Hotel Coruña — weekly')).toBeInTheDocument();
      expect(screen.queryByText('sch-1a2b3c4d')).not.toBeInTheDocument();
    });

    it('describes the timing in words instead of the raw cron', () => {
      render(<ScheduleManager {...buildProps({ schedules: [weeklySchedule] })} />);

      expect(screen.getByText('Weekly on Monday at 09:00 (Europe/Madrid)')).toBeInTheDocument();
    });

    it('names the groups a group-scoped schedule runs', () => {
      render(<ScheduleManager {...buildProps({ schedules: [weeklySchedule] })} />);

      expect(screen.getByText('Groups: Hotel Coruña')).toBeInTheDocument();
    });

    it('says all active keywords for an all-scope schedule', () => {
      render(<ScheduleManager {...buildProps({ schedules: [buildSchedule({ scope: { mode: 'all' } })] })} />);

      expect(screen.getByText('All active keywords')).toBeInTheDocument();
    });

    it('marks legacy schedules and lists their keyword texts', () => {
      render(<ScheduleManager {...buildProps({ schedules: [legacyKeywordSchedule] })} />);

      expect(screen.getByText('Legacy')).toBeInTheDocument();
      expect(screen.getByText(/2 keyword\(s\) from the previous version: best hotels malaga, boutique hotels madrid/)).toBeInTheDocument();
    });

    it('shows a disabled badge for a disabled schedule', () => {
      render(<ScheduleManager {...buildProps({
        schedules: [buildSchedule({
          enabled: false,
          state: 'DISABLED' 
        })] 
      })} />);

      expect(screen.getByText('Disabled')).toBeInTheDocument();
    });

    it('shows empty state when no schedules', () => {
      render(<ScheduleManager {...buildProps()} />);

      expect(screen.getByText(/No schedules/i)).toBeInTheDocument();
    });
  });

  describe('initial load', () => {
    it('loads schedules from the API on mount', async () => {
      const props = buildProps();
      mockFetchSchedules.mockResolvedValue([weeklySchedule]);

      render(<ScheduleManager {...props} />);

      await waitFor(() => expect(props.setSchedules).toHaveBeenCalledWith([weeklySchedule]));
    });
  });

  describe('creating a schedule', () => {
    it('defaults to running all keywords daily at 09:00 UTC, enabled', async () => {
      render(<ScheduleManager {...buildProps()} />);
      await openCreateForm();

      expect(screen.getByRole('radio', { name: /All keywords/i })).toBeChecked();
      expect(screen.getByLabelText('Frequency')).toHaveValue('daily');
      expect(screen.getByLabelText('Time')).toHaveValue('09:00');
      expect(screen.getByLabelText('Timezone')).toHaveValue('UTC');
    });

    it('requires a name before saving', async () => {
      render(<ScheduleManager {...buildProps()} />);
      await openCreateForm();

      await userEvent.click(screen.getByRole('button', { name: 'Create Schedule' }));

      expect(screen.getByText('Give the schedule a name')).toBeInTheDocument();
      expect(mockCreateSchedule).not.toHaveBeenCalled();
    });

    it('posts the display name, timing and scope', async () => {
      render(<ScheduleManager {...buildProps()} />);
      await openCreateForm();
      await userEvent.type(screen.getByLabelText('Schedule name'), 'Hotel Coruña — weekly');
      await userEvent.selectOptions(screen.getByLabelText('Frequency'), 'weekly');
      await userEvent.selectOptions(screen.getByLabelText('Day of week'), 'FRI');
      await userEvent.clear(screen.getByLabelText('Timezone'));
      await userEvent.type(screen.getByLabelText('Timezone'), 'Europe/Madrid');
      await userEvent.click(screen.getByRole('radio', { name: /Keyword groups/i }));
      await userEvent.click(screen.getByRole('checkbox', { name: 'Include group Hotel Coruña' }));

      await userEvent.click(screen.getByRole('button', { name: 'Create Schedule' }));

      expect(mockCreateSchedule).toHaveBeenCalledWith({
        display_name: 'Hotel Coruña — weekly',
        frequency: 'weekly',
        time: '09:00',
        timezone: 'Europe/Madrid',
        day_of_week: 'FRI',
        day_of_month: 1,
        enabled: true,
        scope: {
          mode: 'groups',
          group_ids: ['group-coruna'] 
        },
      });
    });

    it('sends the picked keyword ids for a specific-keywords scope', async () => {
      render(<ScheduleManager {...buildProps()} />);
      await openCreateForm();
      await userEvent.type(screen.getByLabelText('Schedule name'), 'Priority');
      await userEvent.click(screen.getByRole('radio', { name: /Specific keywords/i }));
      await userEvent.click(screen.getByRole('checkbox', { name: 'best hotels malaga' }));

      await userEvent.click(screen.getByRole('button', { name: 'Create Schedule' }));

      expect(mockCreateSchedule).toHaveBeenCalledWith(expect.objectContaining({
        scope: {
          mode: 'keywords',
          keyword_ids: ['kw-1'] 
        },
      }));
    });

    it('blocks saving a group scope with no group selected', async () => {
      render(<ScheduleManager {...buildProps()} />);
      await openCreateForm();
      await userEvent.type(screen.getByLabelText('Schedule name'), 'Empty');
      await userEvent.click(screen.getByRole('radio', { name: /Keyword groups/i }));

      await userEvent.click(screen.getByRole('button', { name: 'Create Schedule' }));

      expect(screen.getByText('Select at least one keyword group')).toBeInTheDocument();
      expect(mockCreateSchedule).not.toHaveBeenCalled();
    });

    it('points at Settings when there are no groups to pick', async () => {
      mockGroups([]);
      render(<ScheduleManager {...buildProps()} />);
      await openCreateForm();

      await userEvent.click(screen.getByRole('radio', { name: /Keyword groups/i }));

      expect(screen.getByText(/No keyword groups yet/i)).toBeInTheDocument();
    });

    it('refuses a day of month above 28 for monthly schedules', async () => {
      render(<ScheduleManager {...buildProps()} />);
      await openCreateForm();
      await userEvent.type(screen.getByLabelText('Schedule name'), 'Monthly');
      await userEvent.selectOptions(screen.getByLabelText('Frequency'), 'monthly');
      await userEvent.clear(screen.getByLabelText(/Day of month/));
      await userEvent.type(screen.getByLabelText(/Day of month/), '31');

      await userEvent.click(screen.getByRole('button', { name: 'Create Schedule' }));

      // The input's max stops the native submit; the model check backs it up.
      expect(screen.getByLabelText(/Day of month/)).toBeInvalid();
      expect(mockCreateSchedule).not.toHaveBeenCalled();
    });

    it('refreshes the list and closes the form after a successful creation', async () => {
      const props = buildProps();
      mockFetchSchedules.mockResolvedValue([weeklySchedule]);
      render(<ScheduleManager {...props} />);
      await openCreateForm();
      await userEvent.type(screen.getByLabelText('Schedule name'), 'Hotel Coruña — weekly');

      await userEvent.click(screen.getByRole('button', { name: 'Create Schedule' }));

      await waitFor(() => expect(props.setSchedules).toHaveBeenCalledWith([weeklySchedule]));
      expect(mockFetchSchedules).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole('form', { name: 'Create schedule' })).not.toBeInTheDocument();
    });

    it('shows the server rejection when the API refuses the schedule', async () => {
      mockCreateSchedule.mockRejectedValue(new ApiRequestError('Unknown timezone', {
        statusCode: 400,
        responseMessage: "Unknown timezone 'Mars/Base'. Use an IANA name such as Europe/Madrid",
      }));
      render(<ScheduleManager {...buildProps()} />);
      await openCreateForm();
      await userEvent.type(screen.getByLabelText('Schedule name'), 'Bad zone');

      await userEvent.click(screen.getByRole('button', { name: 'Create Schedule' }));

      expect(screen.getByText(/Unknown timezone 'Mars\/Base'/)).toBeInTheDocument();
    });
  });

  describe('editing a schedule', () => {
    it('opens the form pre-filled from the schedule when its card is clicked', async () => {
      render(<ScheduleManager {...buildProps({ schedules: [weeklySchedule] })} />);

      await openEditForm('Hotel Coruña — weekly');

      expect(screen.getByRole('form', { name: 'Edit schedule' })).toBeInTheDocument();
      expect(screen.getByLabelText('Schedule name')).toHaveValue('Hotel Coruña — weekly');
      expect(screen.getByLabelText('Frequency')).toHaveValue('weekly');
      expect(screen.getByLabelText('Timezone')).toHaveValue('Europe/Madrid');
    });

    it('pre-selects the schedule scope', async () => {
      render(<ScheduleManager {...buildProps({ schedules: [weeklySchedule] })} />);

      await openEditForm('Hotel Coruña — weekly');

      expect(screen.getByRole('radio', { name: /Keyword groups/i })).toBeChecked();
      expect(screen.getByRole('checkbox', { name: 'Include group Hotel Coruña' })).toBeChecked();
    });

    it('saves through PUT with the changed fields and the untouched ones', async () => {
      render(<ScheduleManager {...buildProps({ schedules: [weeklySchedule] })} />);
      await openEditForm('Hotel Coruña — weekly');
      await userEvent.clear(screen.getByLabelText('Time'));
      await userEvent.type(screen.getByLabelText('Time'), '18:30');
      await userEvent.click(screen.getByRole('checkbox', { name: /Enabled/ }));

      await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

      expect(mockUpdateSchedule).toHaveBeenCalledWith('sch-1a2b3c4d', {
        display_name: 'Hotel Coruña — weekly',
        frequency: 'weekly',
        time: '18:30',
        timezone: 'Europe/Madrid',
        day_of_week: 'MON',
        day_of_month: 1,
        enabled: false,
        scope: {
          mode: 'groups',
          group_ids: ['group-coruna'] 
        },
      });
      expect(mockCreateSchedule).not.toHaveBeenCalled();
    });

    it('explains that a legacy keyword-text schedule must be re-scoped', async () => {
      render(<ScheduleManager {...buildProps({ schedules: [legacyKeywordSchedule] })} />);

      await openEditForm('priority-daily');

      expect(screen.getByText(/Choose its keywords again below/)).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: /All keywords/i })).toBeChecked();
    });

    it('cancel closes the editor without saving', async () => {
      render(<ScheduleManager {...buildProps({ schedules: [weeklySchedule] })} />);
      await openEditForm('Hotel Coruña — weekly');

      await userEvent.click(within(screen.getByRole('form', { name: 'Edit schedule' })).getByRole('button', { name: 'Cancel' }));

      expect(screen.queryByRole('form', { name: 'Edit schedule' })).not.toBeInTheDocument();
      expect(mockUpdateSchedule).not.toHaveBeenCalled();
    });
  });

  describe('run now', () => {
    it('starts an execution for the schedule and reports it', async () => {
      render(<ScheduleManager {...buildProps({ schedules: [weeklySchedule] })} />);

      await userEvent.click(screen.getByRole('button', { name: 'Run schedule Hotel Coruña — weekly now' }));

      expect(mockRunSchedule).toHaveBeenCalledWith('sch-1a2b3c4d');
      expect(screen.getByText('Analysis started for Hotel Coruña — weekly (1 group(s))')).toBeInTheDocument();
    });

    it('does not open the editor when run now is clicked', async () => {
      render(<ScheduleManager {...buildProps({ schedules: [weeklySchedule] })} />);

      await userEvent.click(screen.getByRole('button', { name: 'Run schedule Hotel Coruña — weekly now' }));

      expect(screen.queryByRole('form', { name: 'Edit schedule' })).not.toBeInTheDocument();
    });
  });

  describe('deleting a schedule', () => {
    it('deletes by id after confirmation and drops the row', async () => {
      const props = buildProps({ schedules: [weeklySchedule] });
      render(<ScheduleManager {...props} />);

      await userEvent.click(screen.getByRole('button', { name: 'Delete schedule Hotel Coruña — weekly' }));
      await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

      expect(mockDeleteSchedule).toHaveBeenCalledWith('sch-1a2b3c4d');
      expect(props.setSchedules).toHaveBeenCalledWith([]);
    });

    it('keeps the row and reports the error when the API refuses', async () => {
      const props = buildProps({ schedules: [weeklySchedule] });
      mockDeleteSchedule.mockRejectedValue(new ApiRequestError('Forbidden', { statusCode: 403 }));
      render(<ScheduleManager {...props} />);

      await userEvent.click(screen.getByRole('button', { name: 'Delete schedule Hotel Coruña — weekly' }));
      await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

      expect(screen.getByText('Managing schedules requires an administrator')).toBeInTheDocument();
      // Only the mount-time load touched the list; the failed delete did not.
      expect(props.setSchedules).toHaveBeenCalledTimes(1);
    });
  });
});

describe('ScheduleManager admin-only controls', () => {
  /**
   * Mutations are Admin-only server-side. Reads stay open, so a non-admin
   * keeps visibility of what is scheduled without any control that would
   * return 403.
   */

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseIsAdmin.mockReturnValue({
      isAdmin: false,
      loading: false,
    });
    mockGroups();
    mockFetchSchedules.mockResolvedValue([]);
  });

  it('hides the new schedule button from non-admin users', () => {
    render(<ScheduleManager {...buildProps()} />);

    expect(screen.queryByRole('button', { name: /New Schedule/i })).not.toBeInTheDocument();
  });

  it('hides edit, run and delete from non-admin users', () => {
    render(<ScheduleManager {...buildProps({ schedules: [weeklySchedule] })} />);

    expect(screen.queryByRole('button', { name: /Edit schedule/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Run schedule/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete schedule/ })).not.toBeInTheDocument();
  });

  it('still lists existing schedules for non-admin users', () => {
    render(<ScheduleManager {...buildProps({ schedules: [weeklySchedule] })} />);

    expect(screen.getByText('Hotel Coruña — weekly')).toBeInTheDocument();
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

    render(<ScheduleManager {...buildProps({ schedules: [weeklySchedule] })} />);

    expect(screen.getByRole('button', { name: 'Delete schedule Hotel Coruña — weekly' })).toBeInTheDocument();
  });
});
