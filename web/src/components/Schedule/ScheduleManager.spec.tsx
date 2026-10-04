import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import {
  render, screen, waitFor, within 
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScheduleManager } from './ScheduleManager';
import {
  GROUP_CORUNA,
  GROUP_MARINO,
  buildProps,
  buildSchedule,
  legacyKeywordSchedule,
  openCreateForm,
  openEditForm,
} from './ScheduleManager-fixtures';

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
import type { Schedule } from '../../types';
import { useIsAdmin } from '../../hooks/useIsAdmin';
import { useKeywordGroups } from '../../hooks/useKeywordGroups';
import { buildKeywordGroupsHookResult } from '../../hooks/useKeywordGroups-fixtures';
import { ApiRequestError } from '../../infrastructure';

const mockFetchSchedules = vi.mocked(fetchSchedules);
const mockCreateSchedule = vi.mocked(createSchedule);
const mockUpdateSchedule = vi.mocked(updateSchedule);
const mockDeleteSchedule = vi.mocked(deleteSchedule);
const mockRunSchedule = vi.mocked(runSchedule);
const mockUseIsAdmin = vi.mocked(useIsAdmin);
const mockUseKeywordGroups = vi.mocked(useKeywordGroups);

const weeklySchedule = buildSchedule();

function mockGroups(groups = [GROUP_CORUNA, GROUP_MARINO]) {
  mockUseKeywordGroups.mockReturnValue(buildKeywordGroupsHookResult(groups));
}

function mockAdmin(isAdmin: boolean) {
  mockUseIsAdmin.mockReturnValue({
    isAdmin,
    loading: false,
  });
}

function renderManager(schedules: Schedule[] = []) {
  const props = buildProps({ schedules });
  render(<ScheduleManager {...props} />);
  return props;
}

async function renderCreateForm() {
  const props = renderManager();
  await openCreateForm();
  return props;
}

async function renderNamedCreateForm(name: string) {
  const props = await renderCreateForm();
  await userEvent.type(screen.getByLabelText('Schedule name'), name);
  return props;
}

async function renderEditForm(schedule: Schedule = weeklySchedule) {
  renderManager([schedule]);
  await openEditForm(schedule.display_name);
}

describe('ScheduleManager', () => {
  beforeEach(() => {
    mockAdmin(true);
    mockGroups();
    mockFetchSchedules.mockResolvedValue([]);
    mockCreateSchedule.mockResolvedValue(weeklySchedule);
    mockUpdateSchedule.mockResolvedValue(weeklySchedule);
    mockDeleteSchedule.mockResolvedValue();
    mockRunSchedule.mockResolvedValue({message: 'Analysis started for Hotel Coruña — weekly (1 group(s))',});
  });

  describe('schedule list', () => {
    it('renders the display name, not the generated id', () => {
      renderManager([weeklySchedule]);

      expect(screen.getByText('Hotel Coruña — weekly')).toBeInTheDocument();
      expect(screen.queryByText('sch-1a2b3c4d')).not.toBeInTheDocument();
    });

    it('describes the timing in words instead of the raw cron', () => {
      renderManager([weeklySchedule]);

      expect(screen.getByText('Weekly on Monday at 09:00 (Europe/Madrid)')).toBeInTheDocument();
    });

    it('names the groups a group-scoped schedule runs', () => {
      renderManager([weeklySchedule]);

      expect(screen.getByText('Groups: Hotel Coruña')).toBeInTheDocument();
    });

    it('says all active keywords for an all-scope schedule', () => {
      renderManager([buildSchedule({ scope: { mode: 'all' } })]);

      expect(screen.getByText('All active keywords')).toBeInTheDocument();
    });

    it('marks legacy schedules and lists their keyword texts', () => {
      renderManager([legacyKeywordSchedule]);

      expect(screen.getByText('Legacy')).toBeInTheDocument();
      expect(screen.getByText(/2 keyword\(s\) from the previous version: best hotels malaga, boutique hotels madrid/)).toBeInTheDocument();
    });

    it('shows a disabled badge for a disabled schedule', () => {
      renderManager([buildSchedule({ enabled: false })]);

      expect(screen.getByText('Disabled')).toBeInTheDocument();
    });

    it('shows empty state when no schedules', () => {
      renderManager();

      expect(screen.getByText(/No schedules/i)).toBeInTheDocument();
    });
  });

  describe('initial load', () => {
    it('loads schedules from the API on mount', async () => {
      mockFetchSchedules.mockResolvedValue([weeklySchedule]);

      const props = renderManager();

      await waitFor(() => expect(props.setSchedules).toHaveBeenCalledWith([weeklySchedule]));
    });
  });

  describe('creating a schedule', () => {
    async function submitCreateForm() {
      await userEvent.click(screen.getByRole('button', { name: 'Create Schedule' }));
    }

    it('shows a generic brand-analysis name example', async () => {
      await renderCreateForm();

      expect(screen.getByLabelText('Schedule name')).toHaveAttribute(
        'placeholder',
        'e.g. Weekly brand analysis'
      );
    });

    it('defaults to running all keywords daily at 09:00 UTC, enabled', async () => {
      await renderCreateForm();

      expect(screen.getByRole('radio', { name: /All keywords/i })).toBeChecked();
      expect(screen.getByLabelText('Frequency')).toHaveValue('daily');
      expect(screen.getByLabelText('Time')).toHaveValue('09:00');
      expect(screen.getByLabelText('Timezone')).toHaveValue('UTC');
    });

    it('requires a name before saving', async () => {
      await renderCreateForm();

      await submitCreateForm();

      expect(screen.getByText('Give the schedule a name')).toBeInTheDocument();
      expect(mockCreateSchedule).not.toHaveBeenCalled();
    });

    it('posts the display name, timing and scope', async () => {
      await renderNamedCreateForm('Hotel Coruña — weekly');
      await userEvent.selectOptions(screen.getByLabelText('Frequency'), 'weekly');
      await userEvent.selectOptions(screen.getByLabelText('Day of week'), 'FRI');
      await userEvent.clear(screen.getByLabelText('Timezone'));
      await userEvent.type(screen.getByLabelText('Timezone'), 'Europe/Madrid');
      await userEvent.click(screen.getByRole('radio', { name: /Keyword groups/i }));
      await userEvent.click(screen.getByRole('checkbox', { name: 'Include group Hotel Coruña' }));

      await submitCreateForm();

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
      await renderNamedCreateForm('Priority');
      await userEvent.click(screen.getByRole('radio', { name: /Specific keywords/i }));
      await userEvent.click(screen.getByRole('checkbox', { name: 'best hotels malaga' }));

      await submitCreateForm();

      expect(mockCreateSchedule).toHaveBeenCalledWith(expect.objectContaining({
        scope: {
          mode: 'keywords',
          keyword_ids: ['kw-1'] 
        },
      }));
    });

    it('blocks saving a group scope with no group selected', async () => {
      await renderNamedCreateForm('Empty');
      await userEvent.click(screen.getByRole('radio', { name: /Keyword groups/i }));

      await submitCreateForm();

      expect(screen.getByText('Select at least one keyword group')).toBeInTheDocument();
      expect(mockCreateSchedule).not.toHaveBeenCalled();
    });

    it('points at Settings when there are no groups to pick', async () => {
      mockGroups([]);
      await renderCreateForm();

      await userEvent.click(screen.getByRole('radio', { name: /Keyword groups/i }));

      expect(screen.getByText(/No keyword groups yet/i)).toBeInTheDocument();
    });

    it('refuses a day of month above 28 for monthly schedules', async () => {
      await renderNamedCreateForm('Monthly');
      await userEvent.selectOptions(screen.getByLabelText('Frequency'), 'monthly');
      await userEvent.clear(screen.getByLabelText(/Day of month/));
      await userEvent.type(screen.getByLabelText(/Day of month/), '31');

      await submitCreateForm();

      // The input's max stops the native submit; the model check backs it up.
      expect(screen.getByLabelText(/Day of month/)).toBeInvalid();
      expect(mockCreateSchedule).not.toHaveBeenCalled();
    });

    it('refreshes the list and closes the form after a successful creation', async () => {
      mockFetchSchedules.mockResolvedValue([weeklySchedule]);
      const props = await renderNamedCreateForm('Hotel Coruña — weekly');

      await submitCreateForm();

      await waitFor(() => expect(props.setSchedules).toHaveBeenCalledWith([weeklySchedule]));
      expect(mockFetchSchedules).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole('form', { name: 'Create schedule' })).not.toBeInTheDocument();
    });

    it('shows the server rejection when the API refuses the schedule', async () => {
      mockCreateSchedule.mockRejectedValue(new ApiRequestError('Unknown timezone', {
        statusCode: 400,
        responseMessage: "Unknown timezone 'Mars/Base'. Use an IANA name such as Europe/Madrid",
      }));
      await renderNamedCreateForm('Bad zone');

      await submitCreateForm();

      expect(screen.getByText(/Unknown timezone 'Mars\/Base'/)).toBeInTheDocument();
    });
  });

  describe('editing a schedule', () => {
    it('opens the form pre-filled from the schedule when its card is clicked', async () => {
      await renderEditForm();

      expect(screen.getByRole('form', { name: 'Edit schedule' })).toBeInTheDocument();
      expect(screen.getByLabelText('Schedule name')).toHaveValue('Hotel Coruña — weekly');
      expect(screen.getByLabelText('Frequency')).toHaveValue('weekly');
      expect(screen.getByLabelText('Timezone')).toHaveValue('Europe/Madrid');
    });

    it('pre-selects the schedule scope', async () => {
      await renderEditForm();

      expect(screen.getByRole('radio', { name: /Keyword groups/i })).toBeChecked();
      expect(screen.getByRole('checkbox', { name: 'Include group Hotel Coruña' })).toBeChecked();
    });

    it('saves through PUT with the changed fields and the untouched ones', async () => {
      await renderEditForm();
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
      await renderEditForm(legacyKeywordSchedule);

      expect(screen.getByText(/Choose its keywords again below/)).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: /All keywords/i })).toBeChecked();
    });

    it('cancel closes the editor without saving', async () => {
      await renderEditForm();

      await userEvent.click(within(screen.getByRole('form', { name: 'Edit schedule' })).getByRole('button', { name: 'Cancel' }));

      expect(screen.queryByRole('form', { name: 'Edit schedule' })).not.toBeInTheDocument();
      expect(mockUpdateSchedule).not.toHaveBeenCalled();
    });
  });

  describe('run now', () => {
    async function runScheduleNow(displayName: string) {
      await userEvent.click(screen.getByRole('button', { name: `Run schedule ${displayName} now` }));
    }

    it('starts an execution for the schedule and reports it', async () => {
      renderManager([weeklySchedule]);

      await runScheduleNow('Hotel Coruña — weekly');

      expect(mockRunSchedule).toHaveBeenCalledWith('sch-1a2b3c4d');
      expect(screen.getByText('Analysis started for Hotel Coruña — weekly (1 group(s))')).toBeInTheDocument();
    });

    it('does not open the editor when run now is clicked', async () => {
      renderManager([weeklySchedule]);

      await runScheduleNow('Hotel Coruña — weekly');

      expect(screen.queryByRole('form', { name: 'Edit schedule' })).not.toBeInTheDocument();
    });
  });

  describe('deleting a schedule', () => {
    async function confirmDeleteOfWeeklySchedule() {
      await userEvent.click(screen.getByRole('button', { name: 'Delete schedule Hotel Coruña — weekly' }));
      await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    }

    it('deletes by id after confirmation and drops the row', async () => {
      const props = renderManager([weeklySchedule]);

      await confirmDeleteOfWeeklySchedule();

      expect(mockDeleteSchedule).toHaveBeenCalledWith('sch-1a2b3c4d');
      expect(props.setSchedules).toHaveBeenCalledWith([]);
    });

    it('keeps the row and reports the error when the API refuses', async () => {
      mockDeleteSchedule.mockRejectedValue(new ApiRequestError('Forbidden', { statusCode: 403 }));
      const props = renderManager([weeklySchedule]);

      await confirmDeleteOfWeeklySchedule();

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
    mockAdmin(false);
    mockGroups();
    mockFetchSchedules.mockResolvedValue([]);
  });

  it('hides the new schedule button from non-admin users', () => {
    renderManager();

    expect(screen.queryByRole('button', { name: /New Schedule/i })).not.toBeInTheDocument();
  });

  it('hides edit, run and delete from non-admin users', () => {
    renderManager([weeklySchedule]);

    expect(screen.queryByRole('button', { name: /Edit schedule/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Run schedule/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete schedule/ })).not.toBeInTheDocument();
  });

  it('still lists existing schedules for non-admin users', () => {
    renderManager([weeklySchedule]);

    expect(screen.getByText('Hotel Coruña — weekly')).toBeInTheDocument();
  });

  it('tells non-admin users an administrator adds schedules', () => {
    /** The admin copy says "Create a schedule", which they cannot do. */
    renderManager();

    expect(screen.getByText(/An administrator can add a schedule/i)).toBeInTheDocument();
  });

  it('shows the delete button to admin users', () => {
    /** Guards the assertions above from passing because of a renamed label. */
    mockAdmin(true);

    renderManager([weeklySchedule]);

    expect(screen.getByRole('button', { name: 'Delete schedule Hotel Coruña — weekly' })).toBeInTheDocument();
  });
});
